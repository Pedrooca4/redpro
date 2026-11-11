import { writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { parseArgs } from "node:util";

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
import { loadManifest, readJSON, sha256File, startLocalServer } from "./runtime.ts";

const suitePath = new URL("./cases.json", import.meta.url);

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
      case: { type: "string" },
    },
  });
  if (!values.server || !values.weights || !values.template || !values.out) {
    throw new BenchError("Informe --server, --weights, --template e --out. Veja docs/AI_BENCH.md.");
  }
  const [manifest, suite] = await Promise.all([loadManifest(), readJSON(suitePath)]);
  validateSuite(suite);
  const model = manifest.models.find((model) => model.id === values.model);
  const cases = values.case ? suite.cases.filter((item) => item.id === values.case) : suite.cases;
  if (!model || cases.length === 0) throw new BenchError("Modelo ou caso fora do manifesto.");

  const startedAt = new Date().toISOString();
  const server = await startLocalServer({
    executable: values.server,
    weights: values.weights,
    template: values.template,
    model,
    runtime: manifest.runtime,
  });
  try {
    const generate = createLocalAdapter(server.apiKey);
    const results: CaseResult[] = [];
    for (const item of cases) {
      if (process.exitCode) break;
      const result = await evaluateCase(item, generate);
      results.push(result);
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
        maxOutputTokens: MAX_OUTPUT_TOKENS,
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

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") await run(args);
  else if (command === "review") await review(args);
  else throw new BenchError("Use run ou review. Veja docs/AI_BENCH.md.");
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : "Falha ao executar a bancada.") + "\n",
  );
  process.exitCode = 1;
}
