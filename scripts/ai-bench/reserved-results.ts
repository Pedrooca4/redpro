import { randomInt, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { groundAnswer } from "./grounding.ts";
import { createKnowledgeSearch, evidenceFor, withKnowledge } from "./knowledge.ts";
import { asObject, BenchError, type ChatMessage, type Completion } from "./local.ts";
import { evaluateCase } from "./report.ts";
import { boundedText, sha256, type ReservedCase } from "./reserved-suite.ts";

export const MODES = ["A", "B", "C"] as const;
type Mode = (typeof MODES)[number];
type Origin =
  | "model-without-rag"
  | "model-with-rag"
  | "deterministic-rule"
  | "clarification"
  | "rag-passthrough";
type Answer = {
  id: string;
  text: string;
  sha256: string;
  origin: Origin;
  rating: null;
};
type Generation = {
  answer: Answer | null;
  telemetry: Omit<Completion, "text"> | null;
  failure: string | null;
};
export type CaseCheckpoint = {
  caseId: string;
  A: Generation;
  B: Generation & { retrieval: ReturnType<typeof evidenceFor> };
  C: {
    answer: Answer | null;
    from: { id: string; sha256: string } | null;
    generationLatencyMs: number | null;
    ruleLatencyMs: number | null;
    sourceIds: string[];
    failure: string | null;
  };
  serverPeakRssKiB: number | null;
};

function answer(text: string, origin: Origin): Answer {
  return { id: randomUUID(), text, sha256: sha256(text), origin, rating: null };
}

export async function collectReserved(
  cases: ReservedCase[],
  search: ReturnType<typeof createKnowledgeSearch>,
  generate: (messages: ChatMessage[]) => Promise<Completion>,
  persist: (result: CaseCheckpoint) => Promise<void>,
  readPeakRss: () => Promise<number | null>,
  interrupted: () => boolean,
) {
  for (const item of cases) {
    if (interrupted()) break;
    const retrieval = search(item);
    const evaluate = async (
      origin: "model-without-rag" | "model-with-rag",
      generation: typeof generate,
    ): Promise<Generation> => {
      const result = await evaluateCase(item, generation);
      if (!result.answer) return { answer: null, telemetry: null, failure: result.failure };
      const { text, ...telemetry } = result.answer;
      return { answer: answer(text, origin), telemetry, failure: null };
    };
    const A = await evaluate("model-without-rag", generate);
    const B = interrupted()
      ? { answer: null, telemetry: null, failure: "Execução interrompida antes de B." }
      : await evaluate("model-with-rag", (messages) =>
          generate(withKnowledge(messages, retrieval)),
        );
    let C: CaseCheckpoint["C"] = {
      answer: null,
      from: null,
      generationLatencyMs: null,
      ruleLatencyMs: null,
      sourceIds: [],
      failure: "A geração B não produziu resposta.",
    };
    if (B.answer && B.telemetry) {
      const start = performance.now();
      const delivered = groundAnswer(item, retrieval, B.answer.text);
      const origin =
        delivered.method === "rule"
          ? "deterministic-rule"
          : delivered.method === "clarification"
            ? "clarification"
            : "rag-passthrough";
      C = {
        answer: answer(delivered.text, origin),
        from: { id: B.answer.id, sha256: B.answer.sha256 },
        generationLatencyMs: B.telemetry.latencyMs,
        ruleLatencyMs: performance.now() - start,
        sourceIds: delivered.sourceIds,
        failure: null,
      };
    }
    await persist({
      caseId: item.id,
      A,
      B: { ...B, retrieval: evidenceFor(retrieval, B.answer?.text ?? null) },
      C,
      serverPeakRssKiB: await readPeakRss(),
    });
  }
}

function responses(results: CaseCheckpoint[]) {
  const byId = new Map<string, { caseId: string; mode: Mode; answer: Answer }>();
  for (const result of results) {
    for (const mode of MODES) {
      const row = asObject(asObject(result)[mode]);
      if (row.answer === null && boundedText(row.failure, 1000)) continue;
      const { id, text, sha256: digest, origin, rating } = asObject(row.answer);
      const expected =
        mode === "A"
          ? ["model-without-rag"]
          : mode === "B"
            ? ["model-with-rag"]
            : ["deterministic-rule", "clarification", "rag-passthrough"];
      if (
        !boundedText(id, 36) ||
        !/^[0-9a-f-]{36}$/.test(id) ||
        byId.has(id) ||
        !boundedText(text, 128 * 1024) ||
        sha256(text) !== digest ||
        typeof origin !== "string" ||
        !expected.includes(origin) ||
        rating !== null ||
        row.failure !== null
      )
        throw new BenchError("Resposta de checkpoint inválida ou alterada.");
      byId.set(id, { caseId: result.caseId, mode, answer: row.answer as Answer });
    }
    if (result.C.answer) {
      if (
        !result.B.answer ||
        result.C.from?.id !== result.B.answer.id ||
        result.C.from?.sha256 !== result.B.answer.sha256 ||
        (result.C.answer.origin === "rag-passthrough" &&
          result.C.answer.sha256 !== result.B.answer.sha256)
      ) {
        throw new BenchError("Procedência de C não confere com a geração B.");
      }
    }
  }
  return byId;
}

export function blindReviewPack(runId: string, cases: ReservedCase[], results: CaseCheckpoint[]) {
  const byId = responses(results);
  return {
    schemaVersion: 1,
    runId,
    cases: cases
      .map((item) => {
        const answers = [...byId.values()]
          .filter((row) => row.caseId === item.id)
          .map(({ answer: response }) => ({
            id: response.id,
            sha256: response.sha256,
            text: response.text,
          }));
        for (let i = answers.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [answers[i], answers[j]] = [answers[j], answers[i]];
        }
        return {
          caseId: item.id,
          edition: item.edition,
          version: item.version,
          question: item.question,
          reference: item.reference,
          criteria: item.rubric,
          criticalError: item.criticalError,
          sourceIds: item.sourceIds,
          answers,
        };
      })
      .filter((item) => item.answers.length > 0),
  };
}

export function scoreReserved(
  runId: string,
  results: CaseCheckpoint[],
  input: unknown,
  caseCount: number,
) {
  const review = asObject(input);
  const byId = responses(results);
  if (
    review.schemaVersion !== 1 ||
    review.runId !== runId ||
    (review.origin !== "human" && review.origin !== "assisted") ||
    !boundedText(review.reviewer, 120) ||
    !Array.isArray(review.ratings) ||
    review.ratings.length === 0
  ) {
    throw new BenchError("Informe a procedência declarada, avaliador, execução e notas.");
  }
  const ratings = new Map<
    string,
    {
      points: number;
      criticalError: boolean;
      editionError: boolean;
      versionError: boolean;
      unsupportedClaims: boolean;
      needsPortugueseReview: boolean;
      note: string;
    }
  >();
  for (const value of review.ratings) {
    const row = asObject(value);
    const {
      id,
      answerSha256,
      points,
      criticalError,
      editionError,
      versionError,
      unsupportedClaims,
      needsPortugueseReview,
      note,
    } = row;
    if (
      typeof id !== "string" ||
      !byId.has(id) ||
      ratings.has(id) ||
      byId.get(id)?.answer.sha256 !== answerSha256 ||
      (points !== 0 && points !== 1 && points !== 2) ||
      typeof criticalError !== "boolean" ||
      (criticalError && points !== 0) ||
      typeof editionError !== "boolean" ||
      typeof versionError !== "boolean" ||
      typeof unsupportedClaims !== "boolean" ||
      typeof needsPortugueseReview !== "boolean" ||
      !boundedText(note, 2000)
    ) {
      throw new BenchError("Nota inválida, duplicada ou vinculada a uma resposta diferente.");
    }
    ratings.set(id, {
      points,
      criticalError,
      editionError,
      versionError,
      unsupportedClaims,
      needsPortugueseReview,
      note,
    });
  }
  const scored = [...byId].map(([id, row]) => ({
    caseId: row.caseId,
    mode: row.mode,
    answerId: id,
    answerSha256: row.answer.sha256,
    answerOrigin: row.answer.origin,
    rating: ratings.get(id) ?? null,
  }));
  return {
    schemaVersion: 1,
    runId,
    review: {
      declaredOrigin: review.origin,
      reviewer: review.reviewer,
      recordedAt: new Date().toISOString(),
    },
    answers: scored,
    summary: Object.fromEntries(
      MODES.map((mode) => {
        const rows = scored.filter((row) => row.mode === mode);
        const classified = rows.flatMap((row) => (row.rating ? [row.rating] : []));
        return [
          mode,
          {
            answered: rows.length,
            missing: caseCount - rows.length,
            rated: classified.length,
            pending: rows.length - classified.length,
            points: classified.length ? classified.reduce((sum, row) => sum + row.points, 0) : null,
            maxPointsForRated: classified.length * 2,
            maxPointsForSuite: caseCount * 2,
            full: classified.filter((row) => row.points === 2).length,
            criticalErrors: classified.filter((row) => row.criticalError).length,
          },
        ];
      }),
    ),
  };
}
