import { createHash } from "node:crypto";

import { asObject, BenchError, type ChatMessage, type Completion } from "./local.ts";

export type EvaluationCase = {
  id: string;
  category: string;
  edition: "Java" | "Bedrock";
  version: string | null;
  question: string;
  sourceIds: string[];
  reference: string;
  rubric: string[];
  criticalError: string;
  exactCommand?: string;
};
export type ReferenceSource = {
  title: string;
  url: string;
  license: string;
  usage: "fact-reference-only";
};
export type EvaluationSuite = {
  schemaVersion: 1;
  purpose: "evaluation-only";
  sources: Record<string, ReferenceSource>;
  cases: EvaluationCase[];
};

export function validateSuite(value: unknown): asserts value is EvaluationSuite {
  const suite = asObject(value);
  const sources = asObject(suite.sources);
  if (
    suite.schemaVersion !== 1 ||
    suite.purpose !== "evaluation-only" ||
    !Array.isArray(suite.cases)
  ) {
    throw new BenchError("Formato inválido do conjunto de avaliação.");
  }
  if (
    Object.values(sources).some((value) => {
      const source = asObject(value);
      return (
        !nonempty(source.title) ||
        !nonempty(source.license) ||
        typeof source.url !== "string" ||
        !source.url.startsWith("https://") ||
        source.usage !== "fact-reference-only"
      );
    })
  ) {
    throw new BenchError("Fonte sem licença ou referência HTTPS.");
  }
  const counts = new Map<string, number>();
  const ids = new Set();
  for (const value of suite.cases) {
    const item = asObject(value);
    if (
      !nonempty(item.id) ||
      ids.has(item.id) ||
      !["crafting", "comandos", "redstone", "sobrevivencia", "edicoes", "ambiguidade"].some(
        (category) => category === item.category,
      ) ||
      (item.edition !== "Java" && item.edition !== "Bedrock") ||
      (item.version !== null && !nonempty(item.version)) ||
      (item.version === null && item.category !== "ambiguidade") ||
      !nonempty(item.question) ||
      !nonempty(item.reference) ||
      !nonempty(item.criticalError) ||
      !Array.isArray(item.rubric) ||
      item.rubric.length === 0 ||
      !item.rubric.every(nonempty) ||
      !Array.isArray(item.sourceIds) ||
      item.sourceIds.length === 0 ||
      !item.sourceIds.every((id) => typeof id === "string" && Object.hasOwn(sources, id)) ||
      (item.exactCommand !== undefined &&
        (typeof item.exactCommand !== "string" || !/^\/[^\r\n]+$/.test(item.exactCommand)))
    ) {
      throw new BenchError("Caso inválido ou sem rastreabilidade.");
    }
    ids.add(item.id);
    const group = `${item.category}/${item.edition}`;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  if (ids.size !== 24 || counts.size !== 12 || [...counts.values()].some((count) => count !== 2)) {
    throw new BenchError("São esperados dois casos por categoria e edição.");
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function messagesFor(item: EvaluationCase): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Você é o assistente experimental MinePRO. Responda em português brasileiro e de forma concisa. " +
        "Considere a edição e a versão informadas. Peça os detalhes indispensáveis quando faltarem. " +
        "Explicite incertezas e não alegue ter executado comandos ou consultado fontes externas.",
    },
    {
      role: "user",
      content: `Edição: ${item.edition}\nVersão: ${item.version ?? "não informada"}\n\n${item.question}`,
    },
  ];
}

export type CaseResult = {
  caseId: string;
  answer: Completion | null;
  answerSha256: string | null;
  failure: string | null;
  deterministic: { exactCommandPresent: boolean | null };
};

export async function evaluateCase(
  item: EvaluationCase,
  generate: (messages: ChatMessage[]) => Promise<Completion>,
): Promise<CaseResult> {
  try {
    const answer = await generate(messagesFor(item));
    const normalize = (line: string) =>
      line
        .trim()
        .replace(/^`(.*)`$/, "$1")
        .replace(/\s+/g, " ");
    return {
      caseId: item.id,
      answer,
      answerSha256: createHash("sha256").update(answer.text).digest("hex"),
      failure: null,
      deterministic: {
        exactCommandPresent: item.exactCommand
          ? answer.text.split("\n").some((line) => normalize(line) === item.exactCommand)
          : null,
      },
    };
  } catch (error) {
    return {
      caseId: item.id,
      answer: null,
      answerSha256: null,
      failure: error instanceof BenchError ? error.message : "Falha local durante a avaliação.",
      deterministic: { exactCommandPresent: null },
    };
  }
}

type HumanReview = {
  caseId: string;
  answerSha256: string;
  factual: "correct" | "partial" | "incorrect";
  editionError: boolean;
  versionError: boolean;
  portuguese: "clear" | "needs-review";
  unsupportedClaims: boolean;
  criticalError: boolean;
};

export function summarize(results: CaseResult[], reviews: HumanReview[] = []) {
  const answers = results.flatMap((result) => (result.answer ? [result.answer] : []));
  const latencies = answers.map((answer) => answer.latencyMs).sort((a, b) => a - b);
  const speeds = answers.flatMap((answer) =>
    answer.tokensPerSecond === null ? [] : [answer.tokensPerSecond],
  );
  const p = (quantile: number) => latencies[Math.ceil(quantile * latencies.length) - 1] ?? null;
  return {
    attempted: results.length,
    answered: answers.length,
    failed: results.length - answers.length,
    truncated: answers.filter((answer) => answer.truncated).length,
    p50LatencyMs: p(0.5),
    p95LatencyMs: p(0.95),
    averageReportedTokensPerSecond: speeds.length
      ? Math.round((speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length) * 100) / 100
      : null,
    humanReview: {
      reviewed: reviews.length,
      factualAccuracy: reviews.length
        ? reviews.filter((review) => review.factual === "correct").length / reviews.length
        : null,
      factualPartial: reviews.length
        ? reviews.filter((review) => review.factual === "partial").length
        : null,
      editionErrors: reviews.length ? reviews.filter((review) => review.editionError).length : null,
      versionErrors: reviews.length ? reviews.filter((review) => review.versionError).length : null,
      clearPortuguese: reviews.length
        ? reviews.filter((review) => review.portuguese === "clear").length
        : null,
      unsupportedClaims: reviews.length
        ? reviews.filter((review) => review.unsupportedClaims).length
        : null,
      criticalErrors: reviews.length
        ? reviews.filter((review) => review.criticalError).length
        : null,
    },
  };
}

export function validateReviews(results: CaseResult[], value: unknown): HumanReview[] {
  if (!Array.isArray(value)) throw new BenchError("Forneça um array JSON de revisões.");
  const ids = new Set();
  return value.map((row) => {
    const review = asObject(row);
    const answer = results.find((result) => result.caseId === review.caseId);
    if (
      !answer?.answer ||
      !answer.answerSha256 ||
      answer.answerSha256 !== review.answerSha256 ||
      createHash("sha256").update(answer.answer.text).digest("hex") !== review.answerSha256 ||
      ids.has(review.caseId) ||
      !["correct", "partial", "incorrect"].some((rating) => rating === review.factual) ||
      !["clear", "needs-review"].some((rating) => rating === review.portuguese) ||
      ![
        review.editionError,
        review.versionError,
        review.unsupportedClaims,
        review.criticalError,
      ].every((value) => typeof value === "boolean")
    ) {
      throw new BenchError(
        "Revisão incompleta, duplicada ou não corresponde à resposta registrada.",
      );
    }
    ids.add(review.caseId);
    return review as HumanReview;
  });
}
