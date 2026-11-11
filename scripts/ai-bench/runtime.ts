import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  asObject,
  BenchError,
  CONTEXT_TOKENS,
  LOCAL_HOST,
  LOCAL_PORT,
  MODEL_ALIAS,
  localRequest,
} from "./local.ts";

type FilePin = { url: string; sha256: string };
export type ModelPin = {
  id: string;
  upstream: { repository: string; revision: string; license: string };
  conversion: {
    repository: string;
    revision: string;
    quantization: "Q4_K_M";
    bytes: number;
  } & FilePin;
  template: FilePin;
};
export type Manifest = {
  schemaVersion: 1;
  runtime: { tag: string; commit: string; archives: Record<string, FilePin> };
  models: ModelPin[];
};

export async function readJSON(file: string | URL): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function sha256File(file: string | URL): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyPinnedFile(file: string, pin: FilePin, bytes?: number): Promise<void> {
  const info = await stat(file);
  if (
    !info.isFile() ||
    (bytes !== undefined && info.size !== bytes) ||
    (await sha256File(file)) !== pin.sha256
  ) {
    throw new BenchError("Arquivo incompatível com o tamanho ou SHA-256 do manifesto.");
  }
}

export async function loadManifest(): Promise<Manifest> {
  const data = (await readJSON(new URL("./models.json", import.meta.url))) as Manifest;
  const commit = /^[0-9a-f]{40}$/;
  const validPin = (pin: FilePin) =>
    /^https:\/\//.test(pin.url) && /^[0-9a-f]{64}$/.test(pin.sha256);
  if (
    data.schemaVersion !== 1 ||
    !/^b\d+$/.test(data.runtime.tag) ||
    !commit.test(data.runtime.commit) ||
    !Object.values(data.runtime.archives).every(validPin) ||
    data.models.length !== 2 ||
    new Set(data.models.map((model) => model.id)).size !== 2 ||
    data.models.some(
      (model) =>
        model.upstream.license !== "Apache-2.0" ||
        !commit.test(model.upstream.revision) ||
        !commit.test(model.conversion.revision) ||
        model.conversion.quantization !== "Q4_K_M" ||
        !Number.isSafeInteger(model.conversion.bytes) ||
        model.conversion.bytes <= 0 ||
        !validPin(model.conversion) ||
        !validPin(model.template) ||
        !model.conversion.url.includes(`/${model.conversion.revision}/`) ||
        !model.template.url.includes(`/${model.upstream.revision}/`),
    )
  ) {
    throw new BenchError("Manifesto de pesos ou runtime inválido.");
  }
  return data;
}

export function serverArgs(weights: string, template: string, threads: number): string[] {
  return [
    "--model",
    weights,
    "--alias",
    MODEL_ALIAS,
    "--host",
    LOCAL_HOST,
    "--port",
    String(LOCAL_PORT),
    "--ctx-size",
    String(CONTEXT_TOKENS),
    "--parallel",
    "1",
    "--threads",
    String(threads),
    "--n-gpu-layers",
    "0",
    "--no-webui",
    "--no-mmproj",
    "--no-context-shift",
    "--jinja",
    "--chat-template-file",
    template,
    "--reasoning",
    "off",
  ];
}

export async function startLocalServer(files: {
  executable: string;
  weights: string;
  template: string;
  model: ModelPin;
  runtime: Manifest["runtime"];
}) {
  const executable = resolve(files.executable);
  const weights = resolve(files.weights);
  const template = resolve(files.template);
  await verifyPinnedFile(weights, files.model.conversion, files.model.conversion.bytes);
  await verifyPinnedFile(template, files.model.template);
  const executableSha256 = await sha256File(executable);

  const apiKey = randomBytes(32).toString("hex");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) =>
        /^(PATH|WINDIR|SYSTEMROOT|TEMP|TMP|TMPDIR|LANG)$/i.test(name),
      ),
    ),
  };
  const cwd = dirname(executable);
  const versionProcess = spawnSync(executable, ["--version"], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  const version = [versionProcess.stdout, versionProcess.stderr].filter(Boolean).join("\n").trim();
  const build = files.runtime.tag.slice(1);
  if (
    versionProcess.status !== 0 ||
    !new RegExp(`\\b${build}\\b`).test(version) ||
    !version.includes(files.runtime.commit.slice(0, 7))
  ) {
    throw new BenchError("Build do llama.cpp diferente do manifesto.");
  }
  const threads = Math.min(availableParallelism(), 8);
  const child = spawn(executable, serverArgs(weights, template, threads), {
    cwd,
    env: { ...env, LLAMA_API_KEY: apiKey },
    stdio: "ignore",
    windowsHide: true,
  });
  let spawnFailed = false;
  child.on("error", () => {
    spawnFailed = true;
  });
  const close = async () => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit").catch(() => undefined);
      child.kill();
      await Promise.race([exit, delay(2500, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const stop = () => {
      void close();
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    };
    signalHandlers.set(signal, stop);
    process.once(signal, stop);
  }

  const stop = async () => {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    await close();
  };
  try {
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) {
        throw new BenchError(
          "llama.cpp encerrou na inicialização. Confira a porta e a compatibilidade do binário.",
        );
      }
      const models = asObject(
        await localRequest("/v1/models", apiKey, undefined, 1500).catch(() => null),
      );
      if (
        Array.isArray(models.data) &&
        models.data.some((entry) => asObject(entry).id === MODEL_ALIAS)
      ) {
        const refused = await localRequest("/v1/models", "invalid-local-key", undefined, 1500).then(
          () => false,
          (error: unknown) => error instanceof BenchError && /HTTP 401\./.test(error.message),
        );
        if (!refused || child.exitCode !== null || child.signalCode !== null) {
          throw new BenchError("A autenticação do servidor local não pôde ser confirmada.");
        }
        return {
          apiKey,
          version,
          executableSha256,
          threads,
          stop,
          peakRssKiB: async () => {
            if (process.platform !== "linux") return null;
            const status = await readFile(`/proc/${child.pid}/status`, "utf8").catch(() => "");
            const hwm = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
            return hwm ? Number(hwm[1]) : null;
          },
        };
      }
      await delay(250);
    }
    throw new BenchError("llama.cpp não ficou pronto no prazo de inicialização.");
  } catch (error) {
    await stop();
    throw error;
  }
}
