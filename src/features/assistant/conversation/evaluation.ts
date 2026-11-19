import { MODES, type Edition, type MinecraftContext } from "../../chat/config.ts";
import type { ConversationResult, Route } from "./contracts.ts";
import { MODEL_TIMEOUT_MS } from "./provider.ts";
import type { ConversationEvent } from "./service.ts";

const weights = {
  factual: 35,
  context: 30,
  continuity: 15,
  utility: 10,
  transparency: 10,
} as const;

type Dimensions = Record<keyof typeof weights, number>;
export type Review = { dimensions: Dimensions; criticalFailures: readonly string[] };

export type EvaluationTurn = {
  expectedRoute: Route;
  resultType: ConversationResult["type"];
  event: Omit<ConversationEvent, "model"> & { model?: string };
};
export type EvaluationRow = {
  scenarioId: string;
  context: MinecraftContext;
  expectedRoute: Route;
  turns: readonly EvaluationTurn[];
  review?: Review;
  modelReview?: Readonly<Record<string, Review>>;
};

function scoreHundredths(dimensions: Dimensions): number {
  return (Object.keys(weights) as (keyof Dimensions)[]).reduce((sum, criterion) => {
    const score = dimensions[criterion];
    if (!Number.isInteger(score) || score < 0 || score > 4)
      throw new RangeError("Rubric scores must be integers from zero to four");
    return sum + score * weights[criterion];
  }, 0);
}

export function weightedScore(dimensions: Dimensions): number {
  return scoreHundredths(dimensions) / 100;
}

function percentile(samples: readonly number[], percentile: number): number | null {
  return samples.length
    ? samples.toSorted((a, b) => a - b)[Math.ceil(percentile * samples.length) - 1]
    : null;
}

export function summarizeLatency(events: readonly EvaluationTurn["event"][]) {
  const completed = events
    .filter((event) => event.outcome === "success")
    .map((event) => event.elapsedMs);
  const penalized = events.map(({ outcome, elapsedMs }) =>
    outcome === "timeout" ? Math.max(elapsedMs, MODEL_TIMEOUT_MS) : elapsedMs,
  );
  const timeouts = events.filter((event) => event.outcome === "timeout").length;
  return {
    attempts: events.length,
    completed: completed.length,
    errors: events.filter((event) => event.outcome === "error").length,
    cancelled: events.filter((event) => event.outcome === "cancelled").length,
    timeouts,
    timeoutPercent: events.length ? (100 * timeouts) / events.length : null,
    completedPercent: events.length ? (100 * completed.length) / events.length : null,
    completedMs: { p50: percentile(completed, 0.5), p95: percentile(completed, 0.95) },
    penalizedMs: { p50: percentile(penalized, 0.5), p95: percentile(penalized, 0.95) },
  };
}

export function summarizeCosts(rows: readonly EvaluationRow[], approved?: number, model?: string) {
  const events = rows
    .flatMap(({ turns }) => turns.map(({ event }) => event))
    .filter((event) => !model || event.model === model);
  const total = (select: (event: EvaluationTurn["event"]) => number) =>
    events.reduce((sum, event) => sum + select(event), 0);
  const confirmedMicros = total((event) => event.confirmedMicros ?? 0);
  const conversations = model
    ? rows.filter(({ turns }) => turns.some(({ event }) => event.model === model)).length
    : rows.length;
  // Ratios retain the exact integers. An empty denominator is deliberately null.
  const average = (count: number) => (count > 0 ? { totalMicros: confirmedMicros, count } : null);
  return {
    currency: "USD_MICROS_VIRTUAL",
    calls: events.filter((event) => event.model).length,
    reservedMicros: total((event) => event.reservationMicros ?? 0),
    confirmedMicros,
    activeReservationsMicros: total((event) =>
      event.financialState === "RESERVED" ? (event.reservationMicros ?? 0) : 0,
    ),
    settledMicros: total((event) =>
      event.financialState === "SETTLED" ? (event.confirmedMicros ?? 0) : 0,
    ),
    uncertainMicros: total((event) =>
      event.financialState === "UNCERTAIN" ? (event.reservationMicros ?? 0) : 0,
    ),
    disputedMicros: total((event) =>
      event.financialState === "DISPUTED"
        ? Math.max(event.reservationMicros ?? 0, event.confirmedMicros ?? 0)
        : 0,
    ),
    releasedMicros: total((event) =>
      event.financialState === "RELEASED"
        ? (event.reservationMicros ?? 0)
        : event.financialState === "SETTLED"
          ? Math.max(0, (event.reservationMicros ?? 0) - (event.confirmedMicros ?? 0))
          : 0,
    ),
    excessOverReservationsMicros: total((event) =>
      Math.max(0, (event.confirmedMicros ?? 0) - (event.reservationMicros ?? 0)),
    ),
    syntheticUnits: {
      input: total((event) => event.syntheticUsage?.inputUnits ?? 0),
      output: total((event) => event.syntheticUsage?.outputUnits ?? 0),
    },
    costPerConversation: average(conversations),
    costPerApprovedConversation: approved === undefined ? null : average(approved),
  };
}

function summarizeQuality(
  rows: readonly EvaluationRow[],
  unusable: (row: EvaluationRow) => boolean,
  minimum: (size: number) => number,
  minimumPerMode: (size: number) => number,
) {
  const scores = rows.map((row) => {
    const critical = row.review?.criticalFailures ?? [];
    const score =
      critical.length || unusable(row)
        ? 0
        : row.review
          ? scoreHundredths(row.review.dimensions)
          : null;
    return { scenarioId: row.scenarioId, mode: row.context.mode, score, critical };
  });
  const total = scores.reduce((sum, { score }) => sum + (score ?? 0), 0);
  const approved = scores.filter(({ score }) => score !== null && score >= 300).length;
  const unknown = scores.some(({ score }) => score === null);
  const criticalFailures = scores.flatMap(({ critical, scenarioId }) =>
    critical.map((reason) => ({ scenarioId, reason })),
  );
  const byMode = MODES.map(({ id: mode }) => {
    const group = scores.filter((score) => score.mode === mode);
    return {
      mode,
      count: group.length,
      required: minimumPerMode(group.length),
      approved: group.filter(({ score }) => score !== null && score >= 300).length,
    };
  });
  return {
    count: rows.length,
    required: minimum(rows.length),
    approved,
    average: rows.length > 0 && !unknown ? total / (100 * rows.length) : null,
    byMode,
    criticalFailures,
    unknown,
    meetsThresholds:
      rows.length > 0 &&
      total >= 330 * rows.length &&
      approved >= minimum(rows.length) &&
      byMode.every(({ approved, required }) => approved >= required),
  };
}

function verdict(result: ReturnType<typeof summarizeQuality>, coverage: boolean) {
  if (result.criticalFailures.length) return "NO_GO";
  if (!coverage || result.unknown) return "INCONCLUSIVE";
  return result.meetsThresholds ? "GO" : "NO_GO";
}

function uniqueRows(rows: readonly EvaluationRow[]) {
  return new Set(rows.map(({ scenarioId }) => scenarioId)).size === rows.length;
}

export function routingFailures(row: EvaluationRow) {
  return row.turns.flatMap(({ expectedRoute, event }, index) => {
    if (event.route === expectedRoute && (expectedRoute !== "MODEL" || event.model)) return [];
    return [
      { scenarioId: row.scenarioId, turn: index + 1, expectedRoute, executedRoute: event.route },
    ];
  });
}

function unusable(turn: EvaluationTurn): boolean {
  return turn.resultType === "ERROR" || turn.event.outcome !== "success";
}

function groupsHaveCoverage(rows: readonly EvaluationRow[], minimum: number): boolean {
  return MODES.every(({ id }) => {
    const editions = rows
      .filter(({ context }) => context.mode === id)
      .map(({ context }) => context.edition);
    return editions.length >= minimum && editions.includes("JAVA") && editions.includes("BEDROCK");
  });
}

export function assessHybrid(rows: readonly EvaluationRow[]) {
  const quality = summarizeQuality(
    rows,
    (row) => !row.turns.length || routingFailures(row).length > 0 || row.turns.some(unusable),
    () => 32,
    () => 5,
  );
  const coverage =
    rows.length === 36 &&
    uniqueRows(rows) &&
    groupsHaveCoverage(rows, 6) &&
    MODES.every(({ id }) =>
      (["JAVA", "BEDROCK"] as Edition[]).every(
        (edition) =>
          rows.filter(({ context }) => context.mode === id && context.edition === edition)
            .length === 3,
      ),
    );
  return {
    ...quality,
    coverage,
    verdict: verdict(quality, coverage),
    routingFailures: rows.flatMap(routingFailures),
  };
}

export function assessModel(rows: readonly EvaluationRow[], model: string) {
  const expected = rows.filter(({ expectedRoute }) => expectedRoute === "MODEL");
  const invoked = (turn: EvaluationTurn) => turn.event.model === model;
  const observed = rows.filter(({ turns }) => turns.some(invoked));
  const comparable = expected.filter(({ turns }) =>
    turns.some((turn) => turn.expectedRoute === "MODEL" && invoked(turn)),
  );
  const quality = summarizeQuality(
    observed.map((row) => ({ ...row, review: row.modelReview?.[model] })),
    ({ turns }) =>
      turns.filter(invoked).some((turn) => unusable(turn) || turn.resultType === "UNAVAILABLE"),
    (count) => Math.ceil((16 * count) / 18),
    (count) => Math.ceil((2 * count) / 3),
  );
  const coverage = uniqueRows(rows) && comparable.length >= 18 && groupsHaveCoverage(comparable, 3);
  const plannedCoverage = expected.length >= 18 && groupsHaveCoverage(expected, 3);
  const deviations = expected.flatMap(({ scenarioId, turns }) =>
    turns.flatMap(({ expectedRoute, event }, index) =>
      expectedRoute === "MODEL" && event.model !== model ? [{ scenarioId, turn: index + 1 }] : [],
    ),
  );
  const extra = observed.flatMap(({ scenarioId, turns }) =>
    turns.flatMap((turn, index) =>
      turn.expectedRoute !== "MODEL" && invoked(turn) ? [{ scenarioId, turn: index + 1 }] : [],
    ),
  );
  return {
    ...quality,
    coverage,
    plannedCoverage,
    expected: expected.length,
    observed: observed.length,
    comparable: comparable.length,
    extra,
    deviations,
    plannedTurns: expected
      .flatMap(({ scenarioId, context, turns }) =>
        turns.map(({ expectedRoute }, index) =>
          JSON.stringify([scenarioId, context, index, expectedRoute]),
        ),
      )
      .sort(),
    verdict: verdict(quality, coverage && plannedCoverage),
  };
}

export function compareModelCoverage(
  left: ReturnType<typeof assessModel>,
  right: ReturnType<typeof assessModel>,
  manifestSha256: readonly [left: string, right: string],
) {
  if (left.verdict === "NO_GO" || right.verdict === "NO_GO") return "NO_GO";
  if (
    !/^[0-9a-f]{64}$/.test(manifestSha256[0]) ||
    manifestSha256[0] !== manifestSha256[1] ||
    left.verdict === "INCONCLUSIVE" ||
    right.verdict === "INCONCLUSIVE" ||
    left.deviations.length ||
    right.deviations.length ||
    left.extra.length ||
    right.extra.length ||
    left.plannedTurns.length !== right.plannedTurns.length ||
    left.plannedTurns.some((turn, index) => turn !== right.plannedTurns[index])
  )
    return "INCONCLUSIVE";
  return "COMPARABLE";
}
