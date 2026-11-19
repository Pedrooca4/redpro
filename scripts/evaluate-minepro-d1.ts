import { createHash } from "node:crypto";
import {
  assessHybrid,
  assessModel,
  summarizeCosts,
  summarizeLatency,
  type EvaluationRow,
} from "../src/features/assistant/conversation/evaluation.ts";
import { createSimulationStore } from "../src/features/assistant/conversation/ledger.ts";
import { createMockProvider, MOCK_MODEL } from "../src/features/assistant/conversation/provider.ts";
import { createConversationService } from "../src/features/assistant/conversation/service.ts";
import { scenarios, type Scenario } from "../tests/fixtures/minepro-d1-scenarios.ts";

export async function simulateScenario(scenario: Scenario) {
  const { scenarioId, context, expectedRoute } = scenario;
  const store = createSimulationStore(1_000_000);
  const provider = createMockProvider(
    ({ message }) => scenario.turns.find((turn) => turn.message === message)?.mock ?? "answer",
  );
  const service = createConversationService({ store, provider });
  const history: string[] = [];
  const observed = [];
  for (const [index, specification] of scenario.turns.entries()) {
    const turnId = `turn-${index + 1}`;
    const { result, event } = await service.execute(scenarioId, {
      context,
      turnId,
      idempotencyKey: turnId,
      message: specification.message,
      history: [...history],
    });
    observed.push({
      expectedRoute,
      resultType: result.type,
      event,
      result,
      expectedType: specification.expectedType,
    });
    if (result.type !== "ERROR") history.push(turnId);
  }
  const calls = observed.filter(({ event }) => event.model === MOCK_MODEL).length;
  const passed =
    calls === scenario.expectedObservability.providerCalls &&
    observed.every(
      ({ event, result, expectedType }) =>
        event.route === expectedRoute &&
        result.type === expectedType &&
        (event.financialState ?? null) === scenario.expectedObservability.financialState &&
        (result.type !== "VERIFIED" || result.procedureId === scenario.verifiedProcedure),
    );
  const row: EvaluationRow = {
    scenarioId,
    context,
    expectedRoute,
    turns: observed.map(({ expectedRoute, resultType, event }) => ({
      expectedRoute,
      resultType,
      event,
    })),
  };
  return { row, observed, passed };
}

export async function runSimulation() {
  const executions = await Promise.all(scenarios.map(simulateScenario));
  const rows = executions.map(({ row }) => row);
  const events = rows.flatMap(({ turns }) => turns.map(({ event }) => event));
  const modelEvents = events.filter(({ model }) => model === MOCK_MODEL);
  return {
    simulation: true,
    provider: MOCK_MODEL,
    actualApiCostUsd: 0,
    manifestSha256: createHash("sha256").update(JSON.stringify(scenarios)).digest("hex"),
    conversations: rows.length,
    passed: executions.filter(({ passed }) => passed).length,
    modelConversations: rows.filter(({ turns }) =>
      turns.some(({ event }) => event.model === MOCK_MODEL),
    ).length,
    modelInvocations: modelEvents.length,
    hybrid: {
      latency: summarizeLatency(events),
      costs: summarizeCosts(rows),
      quality: assessHybrid(rows),
    },
    mock: {
      latency: summarizeLatency(modelEvents),
      costs: summarizeCosts(rows, undefined, MOCK_MODEL),
      quality: assessModel(rows, MOCK_MODEL),
    },
    results: executions.map(({ row, observed, passed }) => ({
      ...row,
      passed,
      expectedTypes: observed.map(({ expectedType }) => expectedType),
    })),
  };
}

if (import.meta.main) {
  const report = await runSimulation();
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.conversations) process.exitCode = 1;
}
