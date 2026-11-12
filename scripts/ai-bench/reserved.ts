import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { arch, availableParallelism, platform, totalmem } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createKnowledgeSearch } from "./knowledge.ts";
import {
  asObject,
  BenchError,
  CONTEXT_TOKENS,
  createLocalAdapter,
  MAX_OUTPUT_TOKENS,
} from "./local.ts";
import {
  privateDirectory,
  readPrivateFile,
  syncDirectory,
  writePrivateJSON,
} from "./reserved-files.ts";
import {
  blindReviewPack,
  collectReserved,
  scoreReserved,
  type CaseCheckpoint,
} from "./reserved-results.ts";
import {
  boundedText,
  canonicalHash,
  loadReservedSuite,
  parsePrivateJSON,
  RESERVED_COUNT,
  RESERVED_SHA256,
  sha256,
} from "./reserved-suite.ts";
import { loadManifest, readJSON, sha256File, startLocalServer } from "./runtime.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PRIVATE_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_BLIND_PACK_BYTES = 16 * 1024 * 1024;
type Suite = Awaited<ReturnType<typeof loadReservedSuite>>;

export function validateReferenceReview(suite: Pick<Suite, "cases">, value: unknown) {
  const review = asObject(value);
  if (
    review.schemaVersion !== 1 ||
    review.datasetSha256 !== RESERVED_SHA256 ||
    review.origin !== "human" ||
    review.independent !== true ||
    !boundedText(review.reviewer, 120) ||
    !Array.isArray(review.cases) ||
    review.cases.length !== suite.cases.length
  ) {
    throw new BenchError(
      "A revisão humana das referências deve abranger toda a bateria congelada.",
    );
  }
  const expected = new Map(suite.cases.map((item) => [item.id, item.referenceSha256]));
  for (const value of review.cases) {
    const row = asObject(value);
    if (
      typeof row.caseId !== "string" ||
      !expected.has(row.caseId) ||
      expected.get(row.caseId) !== row.referenceSha256 ||
      row.sourcesVerified !== true ||
      row.editionVerified !== true ||
      row.versionVerified !== true ||
      row.rubricVerified !== true
    ) {
      throw new BenchError("A revisão tem caso duplicado, pendente ou com referência divergente.");
    }
    expected.delete(row.caseId);
  }
  return { reviewer: review.reviewer, declaredIndependent: true, origin: "human" };
}

async function readResult(path: string) {
  return parsePrivateJSON(
    await readPrivateFile(path, MAX_PRIVATE_RESULT_BYTES, { recoverPublishedFile: true }),
  );
}

async function readCheckpoints(suite: Suite, runId: string) {
  if (!UUID.test(runId)) throw new BenchError("ID de execução inválido.");
  const directory = await privateDirectory(join(suite.root, runId));
  const header = asObject(await readResult(join(directory, "manifest.json")));
  if (
    header.schemaVersion !== 1 ||
    header.runId !== runId ||
    asObject(header.dataset).sha256 !== RESERVED_SHA256
  ) {
    throw new BenchError("Manifesto privado não corresponde à bateria e execução selecionadas.");
  }
  const cases: CaseCheckpoint[] = [];
  for (const item of suite.cases) {
    const checkpoint = await readResult(join(directory, `case-${item.id}.json`)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    if (checkpoint === undefined) continue;
    const record = asObject(checkpoint);
    if (
      record.schemaVersion !== 1 ||
      record.runId !== runId ||
      record.datasetSha256 !== RESERVED_SHA256 ||
      asObject(record.result).caseId !== item.id
    ) {
      throw new BenchError("Checkpoint não corresponde à execução, bateria ou caso esperado.");
    }
    cases.push(record.result as CaseCheckpoint);
  }
  return { directory, cases };
}

async function startReserved(suite: Suite, executable: string, weights: string, template: string) {
  const review = await readPrivateFile(join(suite.root, "reference-review.json"), 256 * 1024).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      throw new BenchError("A revisão humana independente das referências está pendente.");
    },
  );
  const referenceReview = validateReferenceReview(suite, parsePrivateJSON(review));
  const freeze = asObject(
    await readJSON(new URL("../../docs/ai-bench-freeze.json", import.meta.url)),
  );
  const files = asObject(freeze.files);
  const reserved = asObject(freeze.reserved);
  const runtimePin = asObject(freeze.runtime);
  const pinnedExecutable = runtimePin.executableSha256;
  if (
    reserved.sha256 !== RESERVED_SHA256 ||
    reserved.cases !== RESERVED_COUNT ||
    typeof pinnedExecutable !== "string" ||
    !/^[0-9a-f]{64}$/.test(pinnedExecutable)
  ) {
    throw new BenchError("O manifesto congelado não corresponde à avaliação reservada.");
  }
  // The 3C manifest documents the historical CLI. The reserved runner verifies
  // only the frozen inputs and generation code used in this new entry point.
  const frozenFiles = [
    "models.json",
    "knowledge.ts",
    "grounding.ts",
    "local.ts",
    "report.ts",
    "runtime.ts",
  ];
  for (const file of frozenFiles) {
    const digest = await sha256File(new URL(file, import.meta.url));
    if (files[`scripts/ai-bench/${file}`] !== digest)
      throw new BenchError(`Código congelado divergente: ${file}.`);
  }
  const corpus = await readFile(new URL("./knowledge.json", import.meta.url));
  const corpusSha256 = sha256(corpus);
  if (files["scripts/ai-bench/knowledge.json"] !== corpusSha256) {
    throw new BenchError("SHA-256 do corpus congelado divergente.");
  }
  const search = createKnowledgeSearch(parsePrivateJSON(corpus));
  const manifest = await loadManifest();
  const model = manifest.models.find(({ id }) => id === "qwen3.5-4b");
  if (
    !model ||
    model.conversion.sha256 !== asObject(freeze.weights).sha256 ||
    model.template.sha256 !== freeze.templateSha256 ||
    manifest.runtime.tag !== runtimePin.tag ||
    manifest.runtime.commit !== runtimePin.commit
  )
    throw new BenchError("Modelo ou runtime diferente do congelamento.");
  const settings = {
    contextTokens: CONTEXT_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    parallel: 1,
    threads: Math.min(availableParallelism(), 8),
    gpuLayers: 0,
    seed: 42,
    temperature: 0,
    thinking: false,
  };
  const frozenSettings = asObject(freeze.settings);
  if (Object.entries(settings).some(([key, value]) => frozenSettings[key] !== value)) {
    throw new BenchError(
      "Este ambiente não reproduz os parâmetros congelados, incluindo as oito threads.",
    );
  }
  if (!(await stat(executable)).isFile() || (await sha256File(executable)) !== pinnedExecutable) {
    throw new BenchError("Executável do llama.cpp diferente do congelamento.");
  }
  const runId = randomUUID();
  const directory = join(suite.root, runId);
  const orchestratorFiles = [
    "run.ts",
    "reserved.ts",
    "reserved-files.ts",
    "reserved-suite.ts",
    "reserved-results.ts",
  ];
  const orchestration = Object.fromEntries(
    await Promise.all(
      orchestratorFiles.map(
        async (file) => [file, await sha256File(new URL(file, import.meta.url))] as const,
      ),
    ),
  );
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(suite.root);
  await writePrivateJSON(join(directory, "manifest.json"), {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    model,
    settings,
    runtime: runtimePin,
    environment: { os: platform(), arch: arch(), node: process.version, ramBytes: totalmem() },
    dataset: { sha256: RESERVED_SHA256, caseIds: suite.cases.map(({ id }) => id) },
    corpusSha256,
    frozenFiles: Object.fromEntries(
      frozenFiles.map((file) => [file, files[`scripts/ai-bench/${file}`]]),
    ),
    orchestration,
    referenceReview: { ...referenceReview, sha256: sha256(review) },
    limitations: [
      "C deriva da geração B. O custo da regra é medido separadamente.",
      "A nota depende de revisão fornecida separadamente, com procedência declarada.",
      "VmHWM é o pico acumulado do processo llama.cpp em Linux.",
    ],
  });
  process.stdout.write(`Execução privada: ${runId}\n`);
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  let attempted = 0;
  let failures = 0;
  let fatal: string | null = null;
  try {
    server = await startLocalServer({
      executable,
      weights,
      template,
      model,
      runtime: manifest.runtime,
    });
    if (server.executableSha256 !== pinnedExecutable || server.threads !== settings.threads) {
      throw new BenchError("Runtime iniciado não corresponde ao congelamento.");
    }
    await collectReserved(
      suite.cases,
      search,
      createLocalAdapter(server.apiKey),
      async (checkpoint) => {
        await writePrivateJSON(join(directory, `case-${checkpoint.caseId}.json`), {
          schemaVersion: 1,
          runId,
          datasetSha256: RESERVED_SHA256,
          result: checkpoint,
        });
        attempted++;
        if (checkpoint.A.failure || checkpoint.B.failure || checkpoint.C.failure) failures++;
      },
      server.peakRssKiB,
      () => Boolean(process.exitCode),
    );
  } catch (error) {
    fatal =
      error instanceof BenchError
        ? error.message
        : "Falha local ao executar ou persistir resultados.";
    throw new BenchError(`${fatal} Os checkpoints concluídos podem ser recuperados.`);
  } finally {
    try {
      const peak = await server?.peakRssKiB();
      await writePrivateJSON(join(directory, "status.json"), {
        runId,
        finishedAt: new Date().toISOString(),
        attempted,
        failures,
        complete: attempted === RESERVED_COUNT,
        fatal,
        serverPeakRssKiB: peak ?? null,
        runtimeVersion: server?.version ?? null,
      });
    } finally {
      await server?.stop();
    }
  }
  if (!process.exitCode && (attempted < RESERVED_COUNT || failures)) process.exitCode = 1;
}

export async function reservedCommand(command: string, args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      "private-dir": { type: "string" },
      "run-id": { type: "string" },
      server: { type: "string" },
      weights: { type: "string" },
      template: { type: "string" },
    },
  });
  const directory = values["private-dir"];
  const runId = values["run-id"];
  const { server, weights, template } = values;
  if (
    !directory ||
    (command !== "reserved-run" && (server || weights || template)) ||
    (runId && command !== "reserved-blind-pack" && command !== "reserved-score")
  ) {
    throw new BenchError("Opções incompatíveis com o comando reservado.");
  }
  const suite = await loadReservedSuite(directory);
  if (command === "reserved-check") {
    process.stdout.write(
      `Bateria: ${suite.cases.length} casos (36 Java, 36 Bedrock), ${Object.keys(suite.sources).length} fontes. SHA-256: ${RESERVED_SHA256}\n`,
    );
    return;
  }
  if (command === "reserved-reference-pack") {
    await writePrivateJSON(join(suite.root, "reference-pack.json"), {
      schemaVersion: 1,
      datasetSha256: RESERVED_SHA256,
      origin: null,
      independent: null,
      reviewer: null,
      sources: suite.sources,
      cases: suite.cases.map((item) => ({
        caseId: item.id,
        question: item.question,
        edition: item.edition,
        version: item.version,
        reference: item.reference,
        criteria: item.rubric,
        criticalError: item.criticalError,
        requiresClarification: item.requiresClarification,
        sourceIds: item.sourceIds,
        referenceSha256: item.referenceSha256,
        sourcesVerified: null,
        editionVerified: null,
        versionVerified: null,
        rubricVerified: null,
        notes: "",
      })),
    });
    return;
  }
  if (command === "reserved-run") {
    if (!server || !weights || !template)
      throw new BenchError("Informe --server, --weights e --template.");
    return startReserved(suite, server, weights, template);
  }
  if (!runId) throw new BenchError("Informe --run-id.");
  const run = await readCheckpoints(suite, runId);
  if (command === "reserved-blind-pack") {
    await writePrivateJSON(join(run.directory, "blind-pack.json"), {
      ...blindReviewPack(runId, suite.cases, run.cases),
      sources: suite.sources,
    });
    return;
  }
  const ratings = await readPrivateFile(
    join(run.directory, "ratings.json"),
    MAX_PRIVATE_RESULT_BYTES,
  );
  const packBytes = await readPrivateFile(
    join(run.directory, "blind-pack.json"),
    MAX_BLIND_PACK_BYTES,
    {
      recoverPublishedFile: true,
    },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    throw new BenchError("Gere e preserve o pacote cego da execução antes de importar as notas.");
  });
  const pack = asObject(parsePrivateJSON(packBytes));
  if (canonicalHash(asObject(pack.sources)) !== canonicalHash(suite.sources)) {
    throw new BenchError("As fontes do pacote cego divergem da bateria congelada.");
  }
  const reportName = `scored-${randomUUID()}.json`;
  await writePrivateJSON(join(run.directory, reportName), {
    ...scoreReserved(runId, suite.cases, run.cases, pack, parsePrivateJSON(ratings)),
    blindPackSha256: sha256(packBytes),
    ratingsSha256: sha256(ratings),
  });
  process.stdout.write(`Notas gravadas em ${reportName}.\n`);
}
