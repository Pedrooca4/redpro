import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createKnowledgeSearch } from "../scripts/ai-bench/knowledge.ts";
import type { ChatMessage, Completion } from "../scripts/ai-bench/local.ts";
import {
  privateDirectory,
  readPrivateFile,
  writePrivateJSON,
} from "../scripts/ai-bench/reserved-files.ts";
import {
  blindReviewPack,
  collectReserved,
  scoreReserved,
  type CaseCheckpoint,
} from "../scripts/ai-bench/reserved-results.ts";
import {
  canonicalHash,
  loadReservedSuite,
  parseReservedSuite,
  RESERVED_NAME,
  RESERVED_SHA256,
  sha256,
} from "../scripts/ai-bench/reserved-suite.ts";
import { validateReferenceReview } from "../scripts/ai-bench/reserved.ts";

function fixture() {
  const source = {
    title: "Fonte fictícia",
    url: "https://www.minecraft.net/fixture",
    license: "fixture",
    publisher: "fixture",
    usage: "fixture",
  };
  const provenanceSha256 = canonicalHash(source);
  const criteria = ["RUBRICA PRIVADA"];
  const reference = "RESPOSTA PRIVADA";
  const criticalError = "CRITÉRIO PRIVADO";
  const categories = {
    crafting: "CRA",
    comandos: "CMD",
    redstone: "RED",
    sobrevivencia: "SUR",
    edicoes: "EDI",
    versoes: "VER",
  };
  const cases = Object.entries(categories).flatMap(([category, prefix]) =>
    ["Java", "Bedrock"].flatMap((edition) =>
      Array.from({ length: 6 }, (_, i) => {
        const version = edition === "Java" ? "1.21.5" : "1.21.80";
        const id = `RES-${prefix}-${edition[0]}0${i + 1}`;
        return {
          id,
          category,
          edition,
          version,
          question: `Pergunta sintética ${id}?`,
          difficulty: ["fácil", "intermediária", "difícil"][Math.floor(i / 2)],
          reference,
          criteria,
          criticalError,
          sourceIds: ["test"],
          requiresClarification: false,
          referenceSha256: canonicalHash({
            edition,
            version,
            reference,
            criteria,
            criticalError,
            sourceHashes: [provenanceSha256],
          }),
        };
      }),
    ),
  );
  return {
    schemaVersion: 1,
    revision: 2,
    purpose: "reserved-evaluation-only",
    language: "pt-BR",
    generatedResponses: 0,
    cases,
    sources: { test: { ...source, provenanceSha256 } },
  };
}

const completed = (text: string): Completion => ({
  text,
  latencyMs: 12,
  inputTokens: 6,
  outputTokens: 4,
  tokensPerSecond: 30,
  truncated: false,
});

async function testDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "minepro-reserved-"));
  await chmod(directory, 0o700);
  return directory;
}

test("valida os 72 casos sintéticos e rejeita quantidade, distribuição, referências e fontes divergentes", () => {
  const data = fixture();
  assert.equal(parseReservedSuite(data).cases.length, 72);
  for (const mutation of [
    (data: ReturnType<typeof fixture>) => data.cases.pop(),
    (data: ReturnType<typeof fixture>) => (data.cases[0].difficulty = "difícil"),
    (data: ReturnType<typeof fixture>) => (data.cases[0].reference = "alterada"),
    (data: ReturnType<typeof fixture>) => (data.cases[0].sourceIds = ["inexistente"]),
    (data: ReturnType<typeof fixture>) => (data.sources.test.url = "https://example.org/"),
    (data: ReturnType<typeof fixture>) => (data.cases[0].question = data.cases[1].question),
  ]) {
    const broken = structuredClone(data);
    mutation(broken);
    assert.throws(() => parseReservedSuite(broken));
  }
});

test("caminho reservado exige diretório e arquivo privados com nome e hash fixos", async () => {
  const directory = await testDirectory();
  try {
    const path = join(directory, RESERVED_NAME);
    await writeFile(join(directory, "outra-bateria.json"), JSON.stringify(fixture()), {
      mode: 0o600,
    });
    await assert.rejects(loadReservedSuite(directory), { code: "ENOENT" });
    await writeFile(path, JSON.stringify(fixture()), { mode: 0o600 });
    await assert.rejects(loadReservedSuite(directory), /SHA-256/);
    await chmod(path, 0o644);
    await assert.rejects(loadReservedSuite(directory), /0600/);
    await chmod(path, 0o600);
    await assert.rejects(readPrivateFile(path, 16), /limite/);
    await link(path, join(directory, "hardlink.json"));
    await assert.rejects(loadReservedSuite(directory), /arquivo privado/i);
    await rm(path);
    await symlink(join(directory, "outra-bateria.json"), path);
    await assert.rejects(loadReservedSuite(directory), { code: "ELOOP" });
    await mkdir(join(directory, "checkout"), { mode: 0o700 });
    await writeFile(join(directory, "checkout", ".git"), "gitdir: fixture");
    await assert.rejects(privateDirectory(join(directory, "checkout")), /Git/);
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/ai-bench/run.ts",
          "reserved-check",
          "--private-dir",
          directory,
          "--suite",
          "outra-bateria.json",
        ],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("o executor simulado faz duas gerações por caso e registra A, B e C independentemente", async () => {
  const { cases } = parseReservedSuite(fixture());
  const corpus = JSON.parse(
    await readFile(new URL("../scripts/ai-bench/knowledge.json", import.meta.url), "utf8"),
  );
  const search = createKnowledgeSearch(corpus);
  const target = cases.find((item) => item.edition === "Bedrock")!;
  target.question = "Qual é a receita da fornalha de pedregulho?";
  const directory = await testDirectory();
  const results: CaseCheckpoint[] = [];
  let calls = 0;
  try {
    await collectReserved(
      cases,
      search,
      async (messages: ChatMessage[]) => {
        const prompt = messages.map(({ content }) => content).join("\n");
        assert.doesNotMatch(prompt, /RESPOSTA PRIVADA|RUBRICA PRIVADA|CRITÉRIO PRIVADO/);
        const rag = calls++ % 2 === 1;
        assert.equal(prompt.includes("Fichas MinePRO compatíveis"), rag);
        return completed(rag ? "Geração com fichas" : "Geração sem fichas");
      },
      async (checkpoint) => {
        await writePrivateJSON(join(directory, `${checkpoint.caseId}.json`), checkpoint);
        results.push(checkpoint);
      },
      async () => 8192,
      () => false,
    );
    assert.equal(calls, 144);
    assert.equal((await readdir(directory)).length, 72);
    const path = join(directory, `${target.id}.json`);
    const row = JSON.parse((await readPrivateFile(path, 128 * 1024)).toString()) as CaseCheckpoint;
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(writePrivateJSON(path, "substituição"), { code: "EEXIST" });
    assert.equal(row.A.answer?.origin, "model-without-rag");
    assert.equal(row.B.answer?.origin, "model-with-rag");
    assert.equal(row.C.answer?.origin, "deterministic-rule");
    assert.equal(row.C.from?.sha256, row.B.answer?.sha256);
    assert.notEqual(row.C.answer?.sha256, row.B.answer?.sha256);
    assert.equal(row.C.answer?.rating, null);
    assert.equal(row.serverPeakRssKiB, 8192);
    assert.ok(row.B.retrieval.cards.some(({ id }) => id === "MP-furnace"));

    const pack = blindReviewPack("run", cases, results);
    assert.equal(pack.cases.flatMap((item) => item.answers).length, 216);
    assert.ok(
      pack.cases.every((item) => item.answers.every((a) => !("origin" in a) && !("mode" in a))),
    );
    const score = (a: NonNullable<typeof row.C.answer>, points: number) => ({
      id: a.id,
      answerSha256: sha256(a.text),
      points,
      criticalError: false,
      editionError: false,
      versionError: false,
      unsupportedClaims: false,
      needsPortugueseReview: false,
      note: "nota simulada",
    });
    const input = {
      schemaVersion: 1,
      runId: "run",
      origin: "assisted",
      reviewer: "fixture",
      ratings: [score(row.A.answer!, 0), score(row.B.answer!, 1), score(row.C.answer!, 2)],
    };
    const report = scoreReserved("run", results, input, 72);
    assert.deepEqual(
      [report.summary.A.points, report.summary.B.points, report.summary.C.points],
      [0, 1, 2],
    );
    assert.equal(report.summary.C.pending, 71);
    assert.equal(report.review.declaredOrigin, "assisted");
    assert.throws(
      () =>
        scoreReserved(
          "run",
          results,
          { ...input, ratings: [{ ...input.ratings[2], answerSha256: row.B.answer!.sha256 }] },
          72,
        ),
      /Nota inválida/,
    );
    assert.throws(
      () =>
        scoreReserved(
          "run",
          results,
          { ...input, ratings: [{ ...input.ratings[2], criticalError: true }] },
          72,
        ),
      /Nota inválida/,
    );
    const duplicateText = results.find((result) => result.C.answer?.origin === "rag-passthrough")!;
    assert.equal(duplicateText.C.answer?.sha256, duplicateText.B.answer?.sha256);
    assert.notEqual(duplicateText.C.answer?.id, duplicateText.B.answer?.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("interrupção conserva o checkpoint já iniciado e ausência de nota", async () => {
  const { cases } = parseReservedSuite(fixture());
  const corpus = JSON.parse(
    await readFile(new URL("../scripts/ai-bench/knowledge.json", import.meta.url), "utf8"),
  );
  const results: CaseCheckpoint[] = [];
  let stopped = false;
  await collectReserved(
    cases,
    createKnowledgeSearch(corpus),
    async () => {
      stopped = true;
      return completed("resultado A");
    },
    async (checkpoint) => {
      results.push(checkpoint);
    },
    async () => null,
    () => stopped,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].A.answer?.text, "resultado A");
  assert.equal(results[0].B.answer, null);
  assert.equal(results[0].C.answer, null);
  assert.match(results[0].B.failure!, /interrompida/);
});

test("revisão humana declarada exige 72 casos, quatro verificações e hashes correspondentes", () => {
  const suite = parseReservedSuite(fixture());
  const review = {
    schemaVersion: 1,
    datasetSha256: RESERVED_SHA256,
    origin: "human",
    independent: true,
    reviewer: "fixture",
    cases: suite.cases.map((item) => ({
      caseId: item.id,
      referenceSha256: item.referenceSha256,
      sourcesVerified: true,
      editionVerified: true,
      versionVerified: true,
      rubricVerified: true,
    })),
  };
  assert.equal(validateReferenceReview(suite, review).reviewer, "fixture");
  assert.throws(() => validateReferenceReview(suite, { ...review, origin: "assisted" }), /humana/);
  assert.throws(
    () => validateReferenceReview(suite, { ...review, cases: review.cases.slice(1) }),
    /abranger/,
  );
  assert.throws(
    () =>
      validateReferenceReview(suite, {
        ...review,
        cases: [...review.cases.slice(1), review.cases[1]],
      }),
    /duplicado/,
  );
  assert.throws(
    () =>
      validateReferenceReview(suite, {
        ...review,
        cases: [{ ...review.cases[0], rubricVerified: false }, ...review.cases.slice(1)],
      }),
    /pendente/,
  );
});
