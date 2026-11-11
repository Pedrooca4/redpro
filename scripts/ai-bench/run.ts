import { writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { parseArgs } from "node:util";

import { groundAnswer } from "./grounding.ts";
import { compareRuns } from "./compare.ts";
import { createKnowledgeSearch, evidenceFor, withKnowledge } from "./knowledge.ts";
import {
  asObject,
  BenchError,
  CONTEXT_TOKENS,
  createLocalAdapter,
  MAX_OUTPUT_TOKENS,
} from "./local.ts";
import {
  evaluateCase,
  summarize,
  validateReviews,
  validateSuite,
  type CaseResult,
} from "./report.ts";
import { reservedCommand } from "./reserved.ts";
import { loadManifest, readJSON, sha256File, startLocalServer } from "./runtime.ts";

const suitePath = new URL("./cases.json", import.meta.url);
const knowledgePath = new URL("./knowledge.json", import.meta.url);

async function saveReport(path: string, report: unknown) {
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`Relatório gravado em ${path}\n`);
}

async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      server: { type: "string" },
      weights: { type: "string" },
      template: { type: "string" },
      out: { type: "string" },
      model: { type: "string", default: "qwen3.5-4b" },
      case: { type: "string", multiple: true },
      knowledge: { type: "string", default: "off" },
      "max-output-tokens": { type: "string", default: String(MAX_OUTPUT_TOKENS) },
    },
  });
  if (!values.server || !values.weights || !values.template || !values.out) {
    throw new BenchError("Informe --server, --weights, --template e --out. Veja docs/AI_BENCH.md.");
  }
  const limit = Number(values["max-output-tokens"]);
  if (values.knowledge !== "on" && values.knowledge !== "off")
    throw new BenchError("Use --knowledge on ou off.");
  if (!/^\d+$/.test(values["max-output-tokens"]) || limit < 64 || limit > 512)
    throw new BenchError("Use um limite inteiro entre 64 e 512 tokens.");
  const [manifest, suite] = await Promise.all([loadManifest(), readJSON(suitePath)]);
  const search =
    values.knowledge === "on" ? createKnowledgeSearch(await readJSON(knowledgePath)) : null;
  const knowledgeSha256 = search ? await sha256File(knowledgePath) : null;
  validateSuite(suite);
  const model = manifest.models.find((model) => model.id === values.model);
  const requested = values.case ? new Set(values.case) : null;
  const cases = requested ? suite.cases.filter((item) => requested.has(item.id)) : suite.cases;
  if (!model || (requested && requested.size !== cases.length))
    throw new BenchError("Modelo ou caso fora do manifesto.");

  const startedAt = new Date().toISOString();
  const server = await startLocalServer({
    executable: values.server,
    weights: values.weights,
    template: values.template,
    model,
    runtime: manifest.runtime,
  });
  try {
    const generate = createLocalAdapter(server.apiKey, undefined, limit);
    const results: (CaseResult & {
      retrieval?: ReturnType<typeof evidenceFor>;
      delivered?: ReturnType<typeof groundAnswer> | null;
    })[] = [];
    for (const item of cases) {
      if (process.exitCode) break;
      const retrieval = search?.(item);
      const result = await evaluateCase(item, (messages) =>
        generate(retrieval ? withKnowledge(messages, retrieval) : messages),
      );
      results.push(
        retrieval
          ? {
              ...result,
              retrieval: evidenceFor(retrieval, result.answer?.text ?? null),
              delivered: result.answer ? groundAnswer(item, retrieval, result.answer.text) : null,
            }
          : result,
      );
      process.stdout.write(
        `${item.id}: ${result.answer ? `${result.answer.latencyMs} ms` : result.failure}\n`,
      );
    }
    const summary = summarize(results);
    const report = {
      schemaVersion: 1,
      mode: "real-local",
      startedAt,
      finishedAt: new Date().toISOString(),
      environment: {
        os: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model ?? null,
        ramBytes: totalmem(),
        node: process.version,
      },
      model,
      runtime: {
        tag: manifest.runtime.tag,
        commit: manifest.runtime.commit,
        reportedVersion: server.version,
        executableSha256: server.executableSha256,
      },
      settings: {
        contextTokens: CONTEXT_TOKENS,
        maxOutputTokens: limit,
        parallel: 1,
        threads: server.threads,
        gpuLayers: 0,
        seed: 42,
        temperature: 0,
        thinking: false,
      },
      dataset: {
        purpose: suite.purpose,
        sha256: await sha256File(suitePath),
        caseIds: cases.map((item) => item.id),
      },
      knowledge: {
        enabled: Boolean(search),
        sha256: knowledgeSha256,
        groundingSha256: search
          ? await sha256File(new URL("./grounding.ts", import.meta.url))
          : null,
        searchAndPromptSha256: search
          ? await sha256File(new URL("./knowledge.ts", import.meta.url))
          : null,
      },
      serverPeakRssKiB: await server.peakRssKiB(),
      summary,
      cases: results,
      reviews: [],
    };
    await saveReport(values.out, report);
    if (!process.exitCode && (summary.failed > 0 || results.length !== cases.length))
      process.exitCode = 1;
  } finally {
    await server.stop();
  }
}

async function review(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { report: { type: "string" }, ratings: { type: "string" }, out: { type: "string" } },
  });
  if (!values.report || !values.ratings || !values.out) {
    throw new BenchError("Informe --report, --ratings e --out. Veja docs/AI_BENCH.md.");
  }
  const report = asObject(await readJSON(values.report));
  if (report.schemaVersion !== 1 || report.mode !== "real-local" || !Array.isArray(report.cases)) {
    throw new BenchError("Relatório de avaliação incompatível.");
  }
  const results = report.cases as CaseResult[];
  const reviews = validateReviews(results, await readJSON(values.ratings));
  await saveReport(values.out, { ...report, reviews, summary: summarize(results, reviews) });
}

async function compare(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: "string" },
      rag: { type: "string" },
      out: { type: "string" },
      "base-ratings": { type: "string" },
      "rag-ratings": { type: "string" },
      "review-origin": { type: "string" },
    },
  });
  if (!values.base || !values.rag || !values.out) {
    throw new BenchError("Informe --base, --rag e --out.");
  }
  const origin = values["review-origin"];
  const baseRatings = values["base-ratings"];
  const ragRatings = values["rag-ratings"];
  if (
    (baseRatings || ragRatings || origin) &&
    (!baseRatings || !ragRatings || (origin !== "human" && origin !== "assisted"))
  ) {
    throw new BenchError("Informe os dois arquivos de notas e --review-origin human ou assisted.");
  }
  const ratings: Parameters<typeof compareRuns>[2] =
    baseRatings && ragRatings && (origin === "human" || origin === "assisted")
      ? { base: await readJSON(baseRatings), rag: await readJSON(ragRatings), origin }
      : undefined;
  await saveReport(
    values.out,
    compareRuns(await readJSON(values.base), await readJSON(values.rag), ratings),
  );
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") await run(args);
  else if (command === "review") await review(args);
  else if (command === "compare") await compare(args);
  else if (
    command === "reserved-check" ||
    command === "reserved-reference-pack" ||
    command === "reserved-run" ||
    command === "reserved-blind-pack" ||
    command === "reserved-score"
  )
    await reservedCommand(command, args);
  else
    throw new BenchError(
      "Use run, review, compare ou um comando reservado. Veja docs/AI_BENCH.md.",
    );
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : "Falha ao executar a bancada.") + "\n",
  );
  process.exitCode = 1;
}
