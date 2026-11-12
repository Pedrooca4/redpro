import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { asObject } from "../ai-bench/local.ts";
import type { EvaluationSuite } from "../ai-bench/report.ts";
import { assessCommands } from "./commands.ts";

const diagnosticPath = new URL("../ai-bench/cases.json", import.meta.url);

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stringIds(value: unknown) {
  return Array.isArray(value) && value.every((id) => typeof id === "string")
    ? (value as string[])
    : null;
}

function archivedReview(value: unknown, origin: unknown, caseId: string, answerSha256: string) {
  if (value === null || value === undefined) return { status: "not-assessed" } as const;
  const review = asObject(value);
  if (
    (origin !== "assisted" && origin !== "human") ||
    review.caseId !== caseId ||
    review.answerSha256 !== answerSha256 ||
    (review.factual !== "correct" && review.factual !== "partial" && review.factual !== "incorrect")
  ) {
    throw new Error(`Nota histórica incompatível com a saída bruta de ${caseId}.`);
  }
  return {
    status: "archived-factual-review",
    origin,
    factualGrade: review.factual,
    note: typeof review.note === "string" ? review.note : null,
  } as const;
}

function auditAnswer(
  value: unknown,
  expected: string,
  caseId: string,
  review?: unknown,
  origin?: unknown,
) {
  const row = asObject(value);
  if (row.caseId !== caseId) throw new Error(`Registro de resposta incompatível com ${caseId}.`);

  const rawText = asObject(row.answer).text;
  const legacy = asObject(row.deterministic).exactCommandPresent;
  const rawMetrics = typeof legacy === "boolean" ? legacy : null;
  if (typeof rawText !== "string") {
    if (
      row.answer !== null ||
      row.answerSha256 !== null ||
      typeof row.failure !== "string" ||
      row.delivered != null ||
      review != null
    ) {
      throw new Error(`Registro de falha inválido em ${caseId}.`);
    }
    return { raw: null, delivered: null, rawFailure: row.failure };
  }

  const rawHash = sha256(rawText);
  if (row.answerSha256 !== rawHash || row.failure !== null)
    throw new Error(`Saída bruta ou hash divergente em ${caseId}.`);
  const retrieval = asObject(row.retrieval);
  const raw = {
    text: rawText,
    sha256: rawHash,
    provenance: {
      method: "model" as const,
      retrievedIds: Array.isArray(retrieval.cards)
        ? stringIds(retrieval.cards.map((card) => asObject(card).id))
        : null,
      citedIds: stringIds(retrieval.cited),
    },
    metrics: { legacyExactCommandPresent: rawMetrics, ...assessCommands(rawText, expected) },
    intentAssessment: archivedReview(review, origin, caseId, rawHash),
  };

  if (row.delivered == null) return { raw, delivered: null, rawFailure: null };
  const { text, method, sourceIds } = asObject(row.delivered);
  const sources = stringIds(sourceIds);
  if (
    typeof text !== "string" ||
    !text.trim() ||
    sources === null ||
    (method !== "model" && method !== "rule" && method !== "clarification") ||
    (method === "model" && text !== rawText)
  )
    throw new Error(`Resposta entregue inválida em ${caseId}.`);

  return {
    raw,
    delivered: {
      text,
      sha256: sha256(text),
      provenance: { method, sourceIds: sources },
      metrics: assessCommands(text, expected),
      intentAssessment: { status: "not-assessed" } as const,
    },
    rawFailure: null,
  };
}

type Assessment = ReturnType<typeof assessCommands>;
function summarize(
  stages: ({ metrics: Assessment & { legacyExactCommandPresent?: boolean | null } } | null)[],
) {
  const assessed = stages.flatMap((stage) => (stage ? [stage.metrics] : []));
  const legacy = assessed.flatMap((item) =>
    typeof item.legacyExactCommandPresent === "boolean" ? [item.legacyExactCommandPresent] : [],
  );
  return {
    assessed: assessed.length,
    unavailable: stages.length - assessed.length,
    legacy: legacy.length
      ? { assessed: legacy.length, matched: legacy.filter(Boolean).length }
      : null,
    referenceTextPresent: assessed.filter((item) => item.referenceTextPresent).length,
    referenceParametersMatch: assessed.filter((item) => item.referenceParametersMatch).length,
    recommendedReferencePresent: assessed.filter((item) => item.recommendedReferencePresent).length,
    conflictingReferencePresentation: assessed.filter(
      (item) => item.conflictingReferencePresentation,
    ).length,
  };
}

export async function replayCommandAudit(input: Buffer) {
  const diagnosticBytes = await readFile(diagnosticPath);
  const diagnosticHash = sha256(diagnosticBytes);
  const suite = JSON.parse(diagnosticBytes.toString("utf8")) as EvaluationSuite;
  const report = asObject(JSON.parse(input.toString("utf8")));
  const comparison = report.scope === "diagnostic-regression";
  const fingerprint = asObject(report.fingerprint);
  const model = asObject(report.model);
  const datasetHash = comparison ? fingerprint.dataset : asObject(report.dataset).sha256;
  if (
    report.schemaVersion !== 1 ||
    datasetHash !== diagnosticHash ||
    (!comparison && report.mode !== "real-local") ||
    !Array.isArray(report.cases)
  ) {
    throw new Error("Forneça um relatório da bancada dos 24 casos diagnósticos.");
  }

  const cases = new Map(suite.cases.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const commandRows = report.cases.flatMap((value) => {
    const row = asObject(value);
    const id = typeof row.caseId === "string" ? row.caseId : "";
    const item = cases.get(id);
    if (!item || seen.has(id)) throw new Error("Relatório contém caso desconhecido ou repetido.");
    seen.add(id);
    return item.exactCommand
      ? [{ row, id, expected: item.exactCommand, edition: item.edition, version: item.version }]
      : [];
  });
  if (!commandRows.length)
    throw new Error("O relatório não contém casos com referência de comando.");

  const variants = comparison ? (["base", "rag"] as const) : (["local"] as const);
  return {
    schemaVersion: 1,
    scope: "diagnostic-command-audit",
    source: {
      sha256: sha256(input),
      datasetSha256: diagnosticHash,
      format: comparison ? "comparison" : "real-local",
      modelId: typeof model.id === "string" ? model.id : null,
      weightsSha256: comparison
        ? (fingerprint.gguf ?? null)
        : (asObject(model.conversion).sha256 ?? null),
    },
    runs: variants.map((variant) => {
      const origin = asObject(asObject(report[variant]).review).origin;
      const results = commandRows.map(({ row, id, expected, edition, version }) => ({
        caseId: id,
        expected,
        edition,
        version,
        ...auditAnswer(
          variant === "local" ? row : row[variant],
          expected,
          id,
          variant === "local" ? undefined : row[`${variant}Review`],
          origin,
        ),
      }));
      return {
        variant,
        summary: {
          raw: summarize(results.map((row) => row.raw)),
          delivered: summarize(results.map((row) => row.delivered)),
        },
        cases: results,
      };
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { in: { type: "string" }, out: { type: "string" } } });
    if (!values.in || !values.out) throw new Error("Use --in RELATORIO.json --out AUDITORIA.json.");
    const report = await replayCommandAudit(await readFile(values.in));
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    process.stdout.write(
      `${JSON.stringify(
        report.runs.map(({ variant, summary }) => ({ variant, ...summary })),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Falha na auditoria de comandos."}\n`,
    );
    process.exitCode = 1;
  }
}
