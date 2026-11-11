import { isDeepStrictEqual } from "node:util";

import { asObject, BenchError } from "./local.ts";
import { summarize, validateReviews, type CaseResult } from "./report.ts";

function readRun(data: unknown, expectedKnowledge: boolean) {
  const report = asObject(data);
  const knowledge = asObject(report.knowledge);
  const dataset = asObject(report.dataset);
  const runtime = asObject(report.runtime);
  const model = asObject(report.model);
  const artifact = asObject(model.conversion);
  const template = asObject(model.template);
  const digest = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (
    report.schemaVersion !== 1 ||
    report.mode !== "real-local" ||
    (expectedKnowledge
      ? knowledge.enabled !== true || !digest(knowledge.sha256)
      : report.knowledge !== undefined && knowledge.enabled !== false) ||
    !digest(dataset.sha256) ||
    !digest(artifact.sha256) ||
    !digest(template.sha256) ||
    !digest(runtime.executableSha256) ||
    !Array.isArray(report.cases) ||
    report.cases.length === 0 ||
    !Array.isArray(dataset.caseIds) ||
    !isDeepStrictEqual(
      dataset.caseIds,
      report.cases.map((item) => asObject(item).caseId),
    ) ||
    new Set(dataset.caseIds).size !== dataset.caseIds.length ||
    !dataset.caseIds.every((id) => typeof id === "string") ||
    Object.keys(asObject(report.settings)).length === 0
  ) {
    throw new BenchError(
      "Relatório incompatível, incompleto ou com modo de recuperação incorreto.",
    );
  }
  return {
    report,
    cases: report.cases as CaseResult[],
    settings: report.settings,
    fingerprint: {
      dataset: dataset.sha256,
      caseIds: dataset.caseIds,
      gguf: artifact.sha256,
      template: template.sha256,
      runtime: runtime.executableSha256,
    },
  };
}

export function compareRuns(
  baseInput: unknown,
  ragInput: unknown,
  ratings?: { base: unknown; rag: unknown; origin: "human" | "assisted" },
) {
  const base = readRun(baseInput, false);
  const rag = readRun(ragInput, true);
  if (
    !isDeepStrictEqual(base.settings, rag.settings) ||
    !isDeepStrictEqual(base.fingerprint, rag.fingerprint)
  ) {
    throw new BenchError("Compare os mesmos casos, pesos, template, runtime e parâmetros.");
  }
  const baseReviews = ratings ? validateReviews(base.cases, ratings.base) : [];
  const ragReviews = ratings ? validateReviews(rag.cases, ratings.rag) : [];
  if (
    !isDeepStrictEqual(
      baseReviews.map((r) => r.caseId).sort(),
      ragReviews.map((r) => r.caseId).sort(),
    )
  ) {
    throw new BenchError("A comparação exige os mesmos casos revisados nas duas execuções.");
  }

  const label = (cases: CaseResult[], reviews: typeof baseReviews) => {
    const { humanReview, ...telemetry } = summarize(cases, reviews);
    return { telemetry, review: { origin: ratings?.origin ?? "none", metrics: humanReview } };
  };
  const rank = { incorrect: 0, partial: 1, correct: 2 };
  const changes = base.cases.map((baseCase, i) => {
    const ragCase = rag.cases[i];
    const baseReview = baseReviews.find((row) => row.caseId === baseCase.caseId);
    const ragReview = ragReviews.find((row) => row.caseId === ragCase.caseId);
    const delta =
      baseReview && ragReview ? rank[ragReview.factual] - rank[baseReview.factual] : null;
    return {
      caseId: baseCase.caseId,
      factualDelta: delta,
      base: baseCase,
      rag: ragCase,
      baseReview,
      ragReview,
    };
  });
  return {
    schemaVersion: 1,
    scope: "diagnostic-regression",
    settings: base.settings,
    fingerprint: base.fingerprint,
    base: {
      ...label(base.cases, baseReviews),
      environment: base.report.environment,
      startedAt: base.report.startedAt,
      finishedAt: base.report.finishedAt,
      peakRssKiB: base.report.serverPeakRssKiB,
    },
    rag: {
      ...label(rag.cases, ragReviews),
      environment: rag.report.environment,
      startedAt: rag.report.startedAt,
      finishedAt: rag.report.finishedAt,
      peakRssKiB: rag.report.serverPeakRssKiB,
      knowledge: rag.report.knowledge,
    },
    improved: changes
      .filter((row) => row.factualDelta !== null && row.factualDelta > 0)
      .map((row) => row.caseId),
    worsened: changes
      .filter((row) => row.factualDelta !== null && row.factualDelta < 0)
      .map((row) => row.caseId),
    cases: changes,
  };
}
