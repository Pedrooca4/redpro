import assert from "node:assert/strict";
import test from "node:test";
import { runSimulation, simulateScenario } from "../scripts/evaluate-minepro-d1.ts";
import {
  assessHybrid,
  assessModel,
  compareModelCoverage,
  summarizeCosts,
  summarizeLatency,
  weightedScore,
  type EvaluationRow,
  type EvaluationTurn,
  type Review,
} from "../src/features/assistant/conversation/evaluation.ts";
import { MOCK_MODEL } from "../src/features/assistant/conversation/provider.ts";
import { MODES } from "../src/features/chat/config.ts";
import { scenarios } from "./fixtures/minepro-d1-scenarios.ts";

function grade(score: number, criticalFailures: string[] = []): Review {
  return {
    dimensions: {
      factual: score,
      context: score,
      continuity: score,
      utility: score,
      transparency: score,
    },
    criticalFailures,
  };
}
const review = grade(4);
const sameManifest = ["c".repeat(64), "c".repeat(64)] as const;

test("the 36 literal cases have stable IDs, three scenarios per edition and all required routes per mode", () => {
  assert.equal(scenarios.length, 36);
  for (const { id } of MODES) {
    const group = scenarios.filter(({ context }) => context.mode === id);
    assert.deepEqual(
      group.map(({ scenarioId }) => scenarioId),
      Array.from({ length: 6 }, (_, index) => `D3-${id}-0${index + 1}`),
    );
    assert.equal(group.filter(({ context }) => context.edition === "JAVA").length, 3);
    assert.equal(group.filter(({ context }) => context.edition === "BEDROCK").length, 3);
    const model = group.filter(({ expectedRoute }) => expectedRoute === "MODEL");
    assert.equal(model.length, 3);
    assert.equal(new Set(model.map(({ context }) => context.edition)).size, 2);
    for (const route of ["DETERMINISTIC", "CLARIFICATION", "UNAVAILABLE"] as const)
      assert.equal(group.filter(({ expectedRoute }) => expectedRoute === route).length, 1);
    assert.ok(group.some(({ turns }) => turns.length > 1));
    assert.ok(
      group.every(
        ({ factualCriteria, criticalCriteria, turns }) =>
          factualCriteria.length &&
          criticalCriteria.length &&
          turns.every(({ message }) => message.length > 12),
      ),
    );
  }
});

for (const scenario of scenarios) {
  test(`matrix ${scenario.scenarioId} preserves the expected route, provenance, turn count and usage`, async () => {
    const { passed, observed } = await simulateScenario(scenario);
    assert.equal(passed, true);
    assert.equal(observed.length, scenario.turns.length);
    for (const { event, result } of observed) {
      assert.equal(event.outcome, "success");
      assert.equal(event.replayed, false);
      if (event.model) {
        assert.equal(result.type === "HYPOTHESIS" || result.type === "CLARIFICATION", true);
        assert.ok(
          event.reservationMicros &&
            event.confirmedMicros &&
            event.reservationMicros > event.confirmedMicros,
        );
      } else {
        assert.equal(event.confirmedMicros, undefined);
        assert.equal(event.reservationMicros, undefined);
      }
      if (result.type === "HYPOTHESIS") {
        assert.equal(result.simulated, true);
        assert.deepEqual(result.sources, []);
      }
      if (result.type === "VERIFIED")
        assert.ok(result.evidence.kind === "CALCULATED" || result.sources.length > 0);
    }
  });
}

test("the harness reports 36/18 conversations, 42/24 turns, separate metrics and no real model grade", async () => {
  const summary = await runSimulation();
  assert.equal(summary.passed, 36);
  assert.equal(summary.modelConversations, 18);
  assert.equal(summary.modelInvocations, 24);
  assert.equal(summary.hybrid.latency.attempts, 42);
  assert.equal(summary.mock.latency.attempts, 24);
  assert.equal(summary.actualApiCostUsd, 0);
  assert.equal(summary.hybrid.quality.verdict, "INCONCLUSIVE");
  assert.equal(summary.mock.quality.verdict, "INCONCLUSIVE");
  assert.equal(summary.mock.costs.confirmedMicros, summary.hybrid.costs.confirmedMicros);
  assert.equal(summary.mock.costs.costPerApprovedConversation, null);
  assert.equal(summary.mock.costs.costPerConversation?.count, 18);
  assert.equal(summary.mock.costs.uncertainMicros, 0);
});

test("the rubric uses integer weights and rejects invalid scores", () => {
  assert.equal(
    weightedScore({ factual: 4, context: 3, continuity: 2, utility: 1, transparency: 0 }),
    2.7,
  );
  assert.throws(() => weightedScore({ ...review.dimensions, transparency: 4.1 }), RangeError);
  assert.throws(() => weightedScore({ ...review.dimensions, factual: -1 }), RangeError);
});

const nominalRows: EvaluationRow[] = scenarios.map(
  ({ scenarioId, context, turns, expectedRoute }) => ({
    scenarioId,
    context,
    expectedRoute,
    turns: turns.map(({ expectedType }, index) => ({
      resultType: expectedType,
      expectedRoute,
      event: {
        route: expectedRoute,
        requestId: `${scenarioId}-${index}`,
        startedAt: 0,
        completedAt: 1,
        elapsedMs: 1,
        outcome: "success",
        replayed: false,
        ...(expectedRoute === "MODEL" && { model: MOCK_MODEL }),
      },
    })),
    review,
    ...(expectedRoute === "MODEL" && { modelReview: { [MOCK_MODEL]: review } }),
  }),
);

test("hybrid approval needs the 32/36 overall cut, each mode cut, 3.3 average and zero critical failures", () => {
  assert.equal(assessHybrid(nominalRows).verdict, "GO");
  const belowOverall = nominalRows.map((row, index) => ({
    ...row,
    review: index % 6 === 0 && index < 30 ? grade(2) : review,
  }));
  assert.equal(assessHybrid(belowOverall).approved, 31);
  assert.equal(assessHybrid(belowOverall).verdict, "NO_GO");
  const belowOneMode = nominalRows.map((row, index) => ({
    ...row,
    review: index < 2 ? grade(2) : review,
  }));
  assert.equal(assessHybrid(belowOneMode).approved, 34);
  assert.equal(assessHybrid(belowOneMode).verdict, "NO_GO");
  assert.equal(
    assessHybrid(nominalRows.map((row) => ({ ...row, review: grade(3) }))).verdict,
    "NO_GO",
  );
  assert.equal(
    assessHybrid([{ ...nominalRows[0], review: grade(4, ["Wrong edition"]) }]).verdict,
    "NO_GO",
  );
});

test("model gate uses independent reviews and keeps failed invocations in the scoring denominator", () => {
  const modelRows = nominalRows.filter(({ expectedRoute }) => expectedRoute === "MODEL");
  assert.equal(assessModel(modelRows, MOCK_MODEL).verdict, "GO");
  const withoutModelReviews = modelRows.map((row) => ({ ...row, modelReview: undefined }));
  assert.equal(assessModel(withoutModelReviews, MOCK_MODEL).verdict, "INCONCLUSIVE");
  const failed = modelRows.map((row, index): EvaluationRow =>
    index < 2
      ? {
          ...row,
          turns: row.turns.map((turn) => ({
            ...turn,
            resultType: "ERROR",
            event: { ...turn.event, outcome: "timeout" },
          })),
        }
      : row,
  );
  const assessment = assessModel(failed, MOCK_MODEL);
  assert.equal(assessment.observed, 18);
  assert.equal(assessment.approved, 16);
  assert.equal(assessment.required, 16);
  assert.equal(assessment.verdict, "NO_GO");
  assert.equal(assessment.byMode[0].approved, 1);
  const critical = modelRows
    .slice(0, 5)
    .map((row, index) =>
      index === 0
        ? { ...row, modelReview: { [MOCK_MODEL]: grade(4, ["Invented evidence"]) } }
        : row,
    );
  assert.equal(assessModel(critical, MOCK_MODEL).verdict, "NO_GO");
  assert.equal(assessModel(modelRows.slice(0, 17), MOCK_MODEL).verdict, "INCONCLUSIVE");
});

test("misrouting is recorded against the hybrid and leaves a candidate with insufficient effective coverage", () => {
  const misrouted: EvaluationRow[] = nominalRows.map((row) =>
    row.scenarioId === "D3-RED-02"
      ? {
          ...row,
          turns: row.turns.map((turn) => ({
            ...turn,
            resultType: "VERIFIED",
            event: { ...turn.event, route: "DETERMINISTIC", model: undefined },
          })),
        }
      : row,
  );
  const hybrid = assessHybrid(misrouted);
  assert.equal(hybrid.routingFailures.length, 1);
  assert.equal(hybrid.approved, 35);
  const model = assessModel(misrouted, MOCK_MODEL);
  assert.equal(model.expected, 18);
  assert.equal(model.observed, 17);
  assert.equal(model.verdict, "INCONCLUSIVE");
  assert.equal(summarizeCosts(misrouted, undefined, MOCK_MODEL).calls, 23);
  assert.equal(
    compareModelCoverage(assessModel(nominalRows, MOCK_MODEL), model, sameManifest),
    "INCONCLUSIVE",
  );
});

test("incomplete edition representation is inconclusive even with 18 invocations", () => {
  const unbalanced = nominalRows.map((row) =>
    row.context.mode === "RED" && row.expectedRoute === "MODEL"
      ? { ...row, context: { ...row.context, edition: "JAVA" as const, game_version: "1.21.1" } }
      : row,
  );
  const gate = assessModel(unbalanced, MOCK_MODEL);
  assert.equal(gate.observed, 18);
  assert.equal(gate.coverage, false);
  assert.equal(gate.verdict, "INCONCLUSIVE");
});

test("larger model subsets use proportional rounded cuts and compare only matching manifests", () => {
  const initial = nominalRows.filter(({ expectedRoute }) => expectedRoute === "MODEL");
  const extra = { ...initial[0], scenarioId: "D3-RED-07", modelReview: { [MOCK_MODEL]: grade(2) } };
  const result = assessModel([...initial, extra], MOCK_MODEL);
  assert.equal(result.observed, 19);
  assert.equal(result.required, 17);
  assert.equal(result.byMode[0].required, 3);
  assert.equal(result.verdict, "GO");
  const small = assessModel(initial, MOCK_MODEL);
  assert.equal(compareModelCoverage(small, small, sameManifest), "COMPARABLE");
  assert.equal(
    compareModelCoverage(small, small, [sameManifest[0], "b".repeat(64)]),
    "INCONCLUSIVE",
  );
  assert.equal(compareModelCoverage(small, result, sameManifest), "INCONCLUSIVE");
  assert.equal(
    compareModelCoverage(
      result,
      assessModel([...initial, { ...extra, scenarioId: "different" }], MOCK_MODEL),
      sameManifest,
    ),
    "INCONCLUSIVE",
  );
});

test("latency nearest ranks include timeout penalties and mark errors and cancellations", () => {
  const baseline = nominalRows[0].turns[0].event;
  const samples: EvaluationTurn["event"][] = [
    { ...baseline, elapsedMs: 80 },
    { ...baseline, elapsedMs: 20 },
    { ...baseline, elapsedMs: 4, outcome: "timeout" },
    { ...baseline, elapsedMs: 34_000, outcome: "timeout" },
    { ...baseline, elapsedMs: 120, outcome: "error" },
    { ...baseline, elapsedMs: 5, outcome: "cancelled" },
  ];
  const latency = summarizeLatency(samples);
  assert.deepEqual(latency.completedMs, { p50: 20, p95: 80 });
  assert.deepEqual(latency.penalizedMs, { p50: 80, p95: 34_000 });
  assert.equal(latency.timeouts, 2);
  assert.equal(latency.errors, 1);
  assert.equal(latency.cancelled, 1);
  assert.equal(latency.timeoutPercent, (100 * 2) / 6);
  assert.deepEqual(summarizeLatency([]).penalizedMs, { p50: null, p95: null });
});

test("cost per approval includes failed conversation spend and holds unresolved commitments separately", () => {
  const set = nominalRows.filter(({ expectedRoute }) => expectedRoute === "MODEL").slice(0, 3);
  const outcomes = ["SETTLED", "DISPUTED", "UNCERTAIN"] as const;
  const rows = set.map((row, index): EvaluationRow => ({
    ...row,
    turns: [
      {
        ...row.turns[0],
        event: {
          ...row.turns[0].event,
          financialState: outcomes[index],
          reservationMicros: 100,
          ...(index < 2 && { confirmedMicros: index === 0 ? 60 : 105 }),
        },
      },
    ],
  }));
  const totals = summarizeCosts(rows, 1, MOCK_MODEL);
  assert.equal(totals.calls, 3);
  assert.equal(totals.settledMicros, 60);
  assert.equal(totals.disputedMicros, 105);
  assert.equal(totals.uncertainMicros, 100);
  assert.equal(totals.releasedMicros, 40);
  assert.equal(totals.excessOverReservationsMicros, 5);
  assert.deepEqual(totals.costPerApprovedConversation, { totalMicros: 165, count: 1 });
});
