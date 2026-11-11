import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLocalAdapter,
  LOCAL_HOST,
  LOCAL_PORT,
  localRequest,
  MODEL_ALIAS,
  parseCompletion,
} from "../scripts/ai-bench/local.ts";
import {
  evaluateCase,
  messagesFor,
  summarize,
  validateReviews,
  validateSuite,
} from "../scripts/ai-bench/report.ts";
import {
  loadManifest,
  readJSON,
  serverArgs,
  sha256File,
  verifyPinnedFile,
} from "../scripts/ai-bench/runtime.ts";

const fixture = {
  model: MODEL_ALIAS,
  choices: [
    {
      message: { role: "assistant", content: "/give @s minecraft:stone 3" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 64, completion_tokens: 8 },
  timings: { predicted_per_second: 12.5 },
};

test("bateria tem 24 casos reservados, dois por edição e categoria, com licenças", async () => {
  const suite = await readJSON(new URL("../scripts/ai-bench/cases.json", import.meta.url));
  validateSuite(suite);
  const item = suite.cases.find((row) => row.id === "AMB-J01")!;
  assert.equal(item.version, null);
  const messages = messagesFor(item);
  assert.match(messages[1].content, /Edição: Java\nVersão: não informada/);
  assert.ok(!JSON.stringify(messages).includes(item.reference));
  assert.throws(() => validateSuite({ ...suite, cases: suite.cases.slice(1) }));
  assert.throws(() => validateSuite({ ...suite, sources: {} }));
});

test("manifesto fixa revisões, quantização, templates e runtime", async () => {
  const manifest = await loadManifest();
  assert.deepEqual(
    manifest.models.map((model) => model.id),
    ["qwen3.5-4b", "qwen3.5-2b"],
  );
  assert.equal(manifest.runtime.tag, "b12110");
  assert.equal(manifest.models[0].conversion.bytes, 2783447136);
  for (const model of manifest.models) {
    assert.equal(model.upstream.license, "Apache-2.0");
    assert.match(model.template.sha256, /^[a-f0-9]{64}$/);
  }
});

test("arquivos de pesos e template divergentes falham antes de iniciar o runtime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minepro-bench-"));
  try {
    const file = join(dir, "fixture");
    await writeFile(file, "fixture");
    const pin = { url: "https://example.com/fixture", sha256: await sha256File(file) };
    await verifyPinnedFile(file, pin, 7);
    await assert.rejects(verifyPinnedFile(file, pin, 8), /tamanho ou SHA-256/);
    await writeFile(file, "alterou");
    await assert.rejects(verifyPinnedFile(file, pin, 7), /tamanho ou SHA-256/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o runtime só recebe loopback, contexto fixo, um slot e modo texto", () => {
  const args = serverArgs("weights.gguf", "template.jinja", 4);
  for (const [key, value] of [
    ["--host", "127.0.0.1"],
    ["--port", "18123"],
    ["--ctx-size", "4096"],
    ["--parallel", "1"],
    ["--n-gpu-layers", "0"],
    ["--reasoning", "off"],
  ]) {
    assert.equal(args[args.indexOf(key) + 1], value);
  }
  assert.ok(args.includes("--no-mmproj"));
  assert.ok(args.includes("--no-webui"));
  assert.ok(!args.includes("--connect"));
});

test("adaptador limita saída, mede tempo e usa somente o caminho local fixo", async () => {
  const generate = createLocalAdapter("test-fixture", async (path, key, body) => {
    assert.equal(path, "/v1/chat/completions");
    assert.equal(key, "test-fixture");
    const request = JSON.parse(body!);
    assert.equal(request.model, MODEL_ALIAS);
    assert.equal(request.stream, false);
    assert.equal(request.max_tokens, 256);
    assert.equal(request.chat_template_kwargs.enable_thinking, false);
    assert.deepEqual(request.messages, [{ role: "user", content: "https://exemplo.invalid/" }]);
    return fixture;
  });
  const result = await generate([{ role: "user", content: "https://exemplo.invalid/" }]);
  assert.equal(result.inputTokens, 64);
  assert.equal(result.outputTokens, 8);
  assert.equal(result.tokensPerSecond, 12.5);
  assert.ok(result.latencyMs >= 0);
});

test("adaptador rejeita esquema, modelo, ferramentas e raciocínio inesperados", () => {
  for (const invalid of [
    {},
    { ...fixture, model: "outro" },
    {
      ...fixture,
      choices: [{ ...fixture.choices[0], message: { role: "assistant", content: "" } }],
    },
    {
      ...fixture,
      choices: [
        { ...fixture.choices[0], message: { role: "assistant", content: "a", tool_calls: [] } },
      ],
    },
    {
      ...fixture,
      choices: [
        { ...fixture.choices[0], message: { role: "assistant", content: "<think>texto</think>" } },
      ],
    },
  ]) {
    assert.throws(() => parseCompletion(invalid, 0), /incompatível/);
  }
  const valid = parseCompletion(
    {
      ...fixture,
      timings: undefined,
      usage: undefined,
      choices: [{ ...fixture.choices[0], finish_reason: "length" }],
    },
    10,
  );
  assert.equal(valid.truncated, true);
  assert.equal(valid.tokensPerSecond, null);
  assert.equal(valid.inputTokens, null);
});

test("URLs e rotas desconhecidas são recusadas antes de abrir socket", async () => {
  const unsafe = "https://example.invalid/" as Parameters<typeof localRequest>[0];
  await assert.rejects(localRequest(unsafe, "test-fixture"), /Rota fora do contrato/);
});

test("transporte HTTP local recusa redirecionamento, respostas grandes, JSON inválido e timeout", async () => {
  const paths: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    switch (req.headers.authorization) {
      case "Bearer redirect":
        res.writeHead(302, { Location: `http://${LOCAL_HOST}:${LOCAL_PORT}/destino` });
        return res.end();
      case "Bearer large":
        return res.end("a".repeat(128 * 1024 + 1));
      case "Bearer invalid":
        return res.end("não é JSON");
      case "Bearer slow":
        return;
      default:
        return res.end(JSON.stringify(fixture));
    }
  });
  await new Promise<void>((resolve, reject) =>
    server.listen(LOCAL_PORT, LOCAL_HOST, resolve).once("error", reject),
  );
  try {
    const answer = await localRequest("/v1/chat/completions", "ok", "{}");
    assert.deepEqual(answer, fixture);
    await assert.rejects(localRequest("/v1/chat/completions", "redirect", "{}"), /HTTP 302/);
    await assert.rejects(localRequest("/v1/chat/completions", "large", "{}"), /limite de bytes/);
    await assert.rejects(localRequest("/v1/chat/completions", "invalid", "{}"), /JSON válido/);
    await assert.rejects(
      localRequest("/v1/chat/completions", "slow", "{}", 40),
      /Tempo de inferência/,
    );
    assert.equal(paths.length, 5);
    assert.ok(paths.every((path) => path === "/v1/chat/completions"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await assert.rejects(localRequest("/v1/chat/completions", "ok", "{}"), /indisponível/);
});

test("relatório não atribui acerto a comandos detectados ou casos sem avaliação humana", async () => {
  const suite = await readJSON(new URL("../scripts/ai-bench/cases.json", import.meta.url));
  validateSuite(suite);
  const item = suite.cases.find((row) => row.id === "CMD-J01")!;
  const result = await evaluateCase(item, async () => parseCompletion(fixture, 36));
  assert.equal(result.deterministic.exactCommandPresent, true);
  const failed = await evaluateCase(item, async () => {
    throw new Error("private mock detail");
  });
  assert.equal(failed.failure, "Falha local durante a avaliação.");
  const summary = summarize([result, failed]);
  assert.equal(summary.answered, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.p95LatencyMs, 36);
  assert.equal(summary.humanReview.factualAccuracy, null);
});

test("revisão humana é vinculada ao hash da resposta e contabilizada separadamente", async () => {
  const suite = await readJSON(new URL("../scripts/ai-bench/cases.json", import.meta.url));
  validateSuite(suite);
  const item = suite.cases.find((row) => row.id === "CMD-J01")!;
  const result = await evaluateCase(item, async () => parseCompletion(fixture, 36));
  const review = {
    caseId: item.id,
    answerSha256: result.answerSha256,
    factual: "correct",
    editionError: false,
    versionError: false,
    portuguese: "clear",
    unsupportedClaims: false,
    criticalError: false,
  };
  const summary = summarize([result], validateReviews([result], [review]));
  assert.equal(summary.humanReview.factualAccuracy, 1);
  assert.equal(summary.humanReview.reviewed, 1);
  assert.throws(() => validateReviews([result], [{ ...review, answerSha256: "outro" }]));
  assert.throws(() => validateReviews([result], [{ ...review, factual: ["correct"] }]));
  assert.throws(() => validateReviews([result], [review, review]));
});
