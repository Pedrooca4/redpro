import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationInput } from "../src/features/assistant/conversation/contracts.ts";
import {
  budgetStatus,
  createSimulationStore,
  reconcile,
  recoverInterrupted,
  type StoreState,
} from "../src/features/assistant/conversation/ledger.ts";
import {
  createMockProvider,
  MOCK_MODEL,
  SYNTHETIC_PRICING,
  inputUnits,
  maximumCharge,
  type ModelAdapter,
  type ModelPrompt,
} from "../src/features/assistant/conversation/provider.ts";
import { createConversationService } from "../src/features/assistant/conversation/service.ts";

const question = "Como organizo as alavancas de um circuito de redstone?";
const java = { edition: "JAVA", game_version: "1.21.1", mode: "RED" } as const;
const bedrock = { edition: "BEDROCK", game_version: "1.21.0", mode: "RED" } as const;
const budget = 100_000;

function turn(turnId = "turn-1", overrides: Partial<ConversationInput> = {}): ConversationInput {
  return {
    turnId,
    idempotencyKey: `key-${turnId}`,
    context: java,
    message: question,
    history: [],
    ...overrides,
  };
}

function attempt(state: StoreState) {
  const row = state.turns[0]?.attempt;
  assert.ok(row);
  return row;
}

function monitored(selected = createMockProvider()) {
  const prompts: ModelPrompt[] = [];
  const provider: ModelAdapter = {
    id: MOCK_MODEL,
    invoke(prompt, signal) {
      prompts.push(structuredClone(prompt));
      return selected.invoke(prompt, signal);
    },
  };
  return { provider, prompts };
}

async function exactReservation() {
  const store = createSimulationStore(budget);
  const service = createConversationService({
    store,
    provider: createMockProvider(),
    checkpoint(stage) {
      if (stage === "after-reservation") throw new Error("Simulated stop");
    },
  });
  await service.execute("session", turn());
  return attempt(store.snapshot()).reservationAmount;
}

test("deterministic geometry is verified with reproducible calculations and has no virtual cost", async () => {
  const store = createSimulationStore();
  const { provider, prompts } = monitored();
  const service = createConversationService({ store, provider });
  for (const context of [java, bedrock]) {
    const { result, event } = await service.execute(
      "session",
      turn(context.edition, {
        context,
        message: "Quantos blocos preciso para construir o piso da base 21 × 21?",
      }),
    );
    assert.equal(event.route, "DETERMINISTIC");
    assert.equal(event.model, undefined);
    assert.equal(result.type, "VERIFIED");
    if (result.type !== "VERIFIED" || result.evidence.kind !== "CALCULATED")
      assert.fail("Expected calculated evidence");
    assert.equal(result.origin, "DETERMINISTIC");
    assert.equal(result.procedureId, "builder-base-21");
    assert.deepEqual(result.sources, []);
    const [floor, walls] = result.evidence.calculations;
    assert.equal(floor.formula, "21 × 21 = 441");
    assert.deepEqual(floor.inputs, { length: 21, width: 21, height: 1 });
    assert.equal(floor.result, 441);
    assert.equal(floor.estimated, false);
    assert.equal(walls.result, 240);
    assert.equal(walls.estimated, true);
  }
  assert.equal(prompts.length, 0);
  assert.equal(budgetStatus(store.snapshot()).committedMicros, 0);
});

test("the router handles conflicting editions, versions, missing context and evidence outside the guide", async () => {
  const { provider, prompts } = monitored();
  const service = createConversationService({ store: createSimulationStore(budget), provider });
  const cases = [
    ["Como reviso este circuito de redstone no Minecraft Bedrock 1.21.0?", java, "CLARIFICATION"],
    ["Como reviso este circuito de redstone em Java 1.20.1?", java, "CLARIFICATION"],
    ["Como organizo alavancas de redstone na versão 1.20.4?", java, "CLARIFICATION"],
    ["Como testo redstone entre Java e Bedrock?", java, "CLARIFICATION"],
    [question, { ...java, game_version: null }, "CLARIFICATION"],
    [question, { ...java, game_version: "1.20.1" }, "UNAVAILABLE"],
    ["Qual seed tem uma caverna na coordenada que eu quero?", bedrock, "UNAVAILABLE"],
    ["Explique a diferença entre um gato e um lobo doméstico.", java, "UNAVAILABLE"],
  ] as const;
  for (const [index, [message, context, expected]] of cases.entries()) {
    const { result } = await service.execute(
      "session",
      turn(`case-${index}`, { message, context }),
    );
    assert.equal(result.type, expected, message);
  }
  assert.equal(prompts.length, 0);
});

test("negated pickaxe asks for clarification, and a same-context follow-up from the store can verify it", async () => {
  const { provider, prompts } = monitored();
  const service = createConversationService({ store: createSimulationStore(budget), provider });
  for (const context of [java, bedrock]) {
    const session = context.edition;
    const miningContext = { ...context, mode: "SURVIVAL" as const };
    const first = turn("mining", {
      context: miningContext,
      message: "Quero minerar diamantes, mas não uso picareta de ferro.",
    });
    const { result: question } = await service.execute(session, first);
    assert.equal(question.type, "CLARIFICATION");
    if (question.type !== "CLARIFICATION") assert.fail();
    assert.equal(question.followUp?.field, "pickaxe");
    const { result: resolved } = await service.execute(
      session,
      turn("pickaxe", {
        context: miningContext,
        message: "Picareta de ferro.",
        history: [first.turnId],
      }),
    );
    assert.equal(resolved.type, "VERIFIED");
    if (resolved.type !== "VERIFIED") assert.fail();
    assert.equal(resolved.procedureId, "survival-mining");
    assert.equal(resolved.evidence.kind, "DOCUMENTED");
    assert.ok(resolved.sources.length);
  }
  assert.equal(prompts.length, 0);
});

test("new turns retain each edition and version without reusing an unrelated guided follow-up", async () => {
  const { provider, prompts } = monitored();
  const service = createConversationService({ store: createSimulationStore(budget), provider });
  await service.execute("session", turn());
  const response = await service.execute(
    "session",
    turn("second", { history: ["turn-1"], context: bedrock }),
  );
  assert.equal(response.result.type, "HYPOTHESIS");
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1].history[0].context, java);
  assert.deepEqual(prompts[1].context, bedrock);
  assert.match(prompts[1].history[0].reply, /^Simulação D1\./);
  const first = turn("mining", {
    context: { ...java, mode: "SURVIVAL" },
    message: "Quero minerar diamantes, mas não uso picareta de ferro.",
  });
  await service.execute("session", first);
  const next = await service.execute(
    "session",
    turn("changed", {
      context: { ...bedrock, mode: "SURVIVAL" },
      message: "Picareta de ferro.",
      history: ["mining"],
    }),
  );
  assert.equal(next.result.type, "UNAVAILABLE");
});

test("no model invocation when the service is missing a permitted provider or has no virtual budget", async () => {
  const { provider, prompts } = monitored();
  const scenarios = [
    [
      createConversationService({ store: createSimulationStore(budget) }),
      "PROVIDER_NOT_AUTHORIZED",
    ],
    [
      createConversationService({
        store: createSimulationStore(budget),
        provider: { ...provider, id: "unauthorized" },
      }),
      "PROVIDER_NOT_AUTHORIZED",
    ],
    [createConversationService({ store: createSimulationStore(), provider }), "BUDGET_UNAVAILABLE"],
  ] as const;
  for (const [service, reason] of scenarios) {
    const { result, event } = await service.execute("session", turn());
    assert.equal(result.type, "UNAVAILABLE");
    if (result.type !== "UNAVAILABLE") assert.fail();
    assert.equal(result.reason, reason);
    assert.equal(event.model, undefined);
  }
  assert.equal(prompts.length, 0);
});

test("interruption before reservation creates no charge or idempotency record", async () => {
  const store = createSimulationStore(budget);
  const { provider, prompts } = monitored();
  const crashed = createConversationService({
    store,
    provider,
    checkpoint(stage) {
      if (stage === "before-reservation") throw new Error("before reservation");
    },
  });
  const { result } = await crashed.execute("session", turn());
  assert.equal(result.type, "ERROR");
  assert.deepEqual(store.snapshot().turns, []);
  assert.equal(prompts.length, 0);
  const retry = await createConversationService({ store, provider }).execute("session", turn());
  assert.equal(retry.result.type, "HYPOTHESIS");
  assert.equal(prompts.length, 1);
});

for (const stage of ["after-reservation", "after-intent"] as const) {
  test(`restart recovers a crash at ${stage} without automatically dispatching`, async () => {
    const store = createSimulationStore(budget);
    const { provider, prompts } = monitored();
    const originally = createConversationService({
      store,
      provider,
      checkpoint(current) {
        if (current === stage) throw new Error("Synthetic interruption");
      },
    });
    const interrupted = await originally.execute("session", turn());
    assert.equal(interrupted.result.type, "ERROR");
    const before = store.snapshot();
    assert.equal(attempt(before).financialState, "RESERVED");
    const withIntent = stage === "after-intent";
    assert.equal(attempt(before).sendIntentAt !== undefined, withIntent);
    const restarted = createSimulationStore(before);
    await recoverInterrupted(restarted, 123);
    assert.equal(
      attempt(restarted.snapshot()).financialState,
      withIntent ? "UNCERTAIN" : "RELEASED",
    );
    assert.equal(
      budgetStatus(restarted.snapshot()).availableMicros,
      budget - (withIntent ? attempt(before).reservationAmount : 0),
    );
    const retry = await createConversationService({ store: restarted, provider }).execute(
      "session",
      turn(),
    );
    assert.equal(retry.result.type, "UNAVAILABLE");
    if (retry.result.type !== "UNAVAILABLE") assert.fail();
    assert.equal(retry.result.reason, withIntent ? "ATTEMPT_UNCERTAIN" : "RESULT_UNAVAILABLE");
    assert.equal(prompts.length, 0);
  });
}

test("timeout holds the full commitment until late evidence and records the amount only once", async () => {
  const store = createSimulationStore(budget);
  const { provider, prompts } = monitored(createMockProvider("timeout"));
  const simulated = createConversationService({ store, provider, timeoutMs: 3 });
  const { result, event } = await simulated.execute("session", turn());
  assert.equal(event.outcome, "timeout");
  assert.equal(event.model, MOCK_MODEL);
  assert.ok(event.elapsedMs >= 0);
  assert.equal(result.type, "ERROR");
  if (result.type !== "ERROR") assert.fail();
  assert.equal(result.error.code, "PROVIDER_TIMEOUT");
  const { attemptId, reservationAmount } = attempt(store.snapshot());
  assert.equal(attempt(store.snapshot()).financialState, "UNCERTAIN");
  assert.equal(budgetStatus(store.snapshot()).availableMicros, budget - reservationAmount);
  assert.equal(await reconcile(store, attemptId, { kind: "not-charged" }), false);
  assert.equal(
    await reconcile(store, attemptId, { kind: "charged", evidenceId: "late", amount: -1 }),
    false,
  );
  assert.equal(
    await reconcile(store, attemptId, { kind: "charged", evidenceId: "late", amount: 200 }),
    true,
  );
  assert.equal(
    await reconcile(store, attemptId, { kind: "charged", evidenceId: "late", amount: 200 }),
    false,
  );
  assert.equal(
    await reconcile(store, attemptId, { kind: "charged", evidenceId: "new-id", amount: 200 }),
    false,
  );
  assert.equal(attempt(store.snapshot()).financialState, "SETTLED");
  assert.equal(budgetStatus(store.snapshot()).committedMicros, 200);
  assert.equal(budgetStatus(store.snapshot()).availableMicros, budget - 200);
  assert.deepEqual(
    attempt(store.snapshot()).history.map(({ event }) => event),
    ["RESERVED", "SEND_INTENT", "UNCERTAIN", "SETTLED"],
  );
  assert.equal(prompts.length, 1);
});

test("transport error is uncertain and only evidence of no charge releases it", async () => {
  const store = createSimulationStore(budget);
  const { provider, prompts } = monitored(createMockProvider("transport-error"));
  const service = createConversationService({ store, provider });
  const { event, result } = await service.execute("session", turn());
  assert.equal(event.financialState, "UNCERTAIN");
  assert.equal(result.type, "ERROR");
  if (result.type !== "ERROR") assert.fail();
  assert.equal(result.error.code, "TRANSPORT_ERROR");
  assert.equal(
    budgetStatus(store.snapshot()).availableMicros,
    budget - attempt(store.snapshot()).reservationAmount,
  );
  const id = attempt(store.snapshot()).attemptId;
  assert.equal(
    await reconcile(store, id, { kind: "not-charged", evidenceId: "zero-charge" }),
    true,
  );
  assert.equal(attempt(store.snapshot()).financialState, "RELEASED");
  assert.equal(budgetStatus(store.snapshot()).availableMicros, budget);
  await service.execute("session", turn());
  assert.equal(prompts.length, 1);
});

test("a completed response lost before delivery is replayable after restart without duplicate cost", async () => {
  const store = createSimulationStore(budget);
  const { provider, prompts } = monitored();
  const crash = createConversationService({
    provider,
    store,
    checkpoint(stage) {
      if (stage === "after-completion") throw new Error("Lost synthetic HTTP result");
    },
  });
  const first = await crash.execute("session", turn());
  assert.equal(first.result.type, "ERROR");
  assert.equal(first.event.financialState, "SETTLED");
  const before = store.snapshot();
  const restarted = createSimulationStore(before);
  await recoverInterrupted(restarted);
  const response = await createConversationService({ store: restarted, provider }).execute(
    "session",
    turn(),
  );
  assert.deepEqual(response.result, before.turns[0].result);
  assert.equal(response.event.replayed, true);
  assert.equal(response.event.model, undefined);
  assert.equal(response.event.confirmedMicros, undefined);
  assert.equal(prompts.length, 1);
  assert.deepEqual(restarted.snapshot(), before);
});

test("two worker services share one dispatch for the same session, turn and key", async () => {
  const store = createSimulationStore(budget);
  const entered = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  const underlying = createMockProvider();
  let calls = 0;
  const provider: ModelAdapter = {
    id: MOCK_MODEL,
    async invoke(prompt, signal) {
      calls += 1;
      entered.resolve();
      await proceed.promise;
      return underlying.invoke(prompt, signal);
    },
  };
  const worker1 = createConversationService({ store, provider });
  const worker2 = createConversationService({ store, provider });
  const first = worker1.execute("session", turn());
  await entered.promise;
  try {
    const duplicate = await worker2.execute("session", turn());
    assert.equal(duplicate.result.type, "UNAVAILABLE");
    if (duplicate.result.type !== "UNAVAILABLE") assert.fail();
    assert.equal(duplicate.result.reason, "ATTEMPT_PENDING");
    assert.equal(duplicate.event.model, undefined);
  } finally {
    proceed.resolve();
  }
  assert.equal((await first).result.type, "HYPOTHESIS");
  assert.equal((await worker2.execute("session", turn())).event.replayed, true);
  assert.equal(calls, 1);
  assert.equal(store.snapshot().turns.length, 1);
});

test("different turns and workers cannot both win the last available virtual reservation", async () => {
  const exact = await exactReservation();
  const store = createSimulationStore(exact);
  const { provider, prompts } = monitored();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      createConversationService({ store, provider }).execute("session", turn(`r-${index}`)),
    ),
  );
  assert.equal(results.filter(({ result }) => result.type === "HYPOTHESIS").length, 1);
  assert.equal(
    results.filter(
      ({ result }) => result.type === "UNAVAILABLE" && result.reason === "BUDGET_UNAVAILABLE",
    ).length,
    9,
  );
  assert.equal(prompts.length, 1);
  const ledger = budgetStatus(store.snapshot());
  assert.equal(ledger.committedMicros, inputUnits(prompts[0]) * 2 + 32 * 5);
  assert.ok(ledger.availableMicros >= 0);
  assert.equal(maximumCharge(prompts[0]), exact);
});

test("an actual charge above the reservation stays auditable and blocks calls until explicit review", async () => {
  const store = createSimulationStore(await exactReservation());
  const { provider, prompts } = monitored(createMockProvider("overcharge"));
  const service = createConversationService({ store, provider });
  const first = await service.execute("session", turn());
  assert.equal(first.result.type, "UNAVAILABLE");
  const row = attempt(store.snapshot());
  assert.equal(row.financialState, "DISPUTED");
  assert.equal(row.confirmedCharge, row.reservationAmount + SYNTHETIC_PRICING.outputMicrosPerUnit);
  assert.equal(budgetStatus(store.snapshot()).committedMicros, row.confirmedCharge);
  assert.equal(budgetStatus(store.snapshot()).availableMicros, 0);
  assert.equal(budgetStatus(store.snapshot()).excessMicros, 5);
  const blocked = await service.execute("session", turn("another"));
  assert.equal(blocked.result.type === "UNAVAILABLE" && blocked.result.reason, "BUDGET_DISPUTED");
  assert.equal(prompts.length, 1);
  assert.equal(
    await reconcile(store, row.attemptId, {
      kind: "dispute-reviewed",
      evidenceId: "ops-review",
      amount: row.confirmedCharge,
    }),
    true,
  );
  assert.equal(attempt(store.snapshot()).financialState, "SETTLED");
  assert.ok(
    attempt(store.snapshot()).history.some(
      ({ event, excessMicros }) => event === "DISPUTED" && excessMicros === 5,
    ),
  );
  assert.equal(budgetStatus(store.snapshot()).excessMicros, 5);
  assert.equal(budgetStatus(store.snapshot()).disputed, false);
});

test("concurrent reconciliation with different evidence never counts two charges for one attempt", async () => {
  const store = createSimulationStore(budget);
  const service = createConversationService({
    store,
    provider: createMockProvider("transport-error"),
  });
  await service.execute("session", turn());
  const row = attempt(store.snapshot());
  await Promise.all([
    reconcile(store, row.attemptId, { kind: "charged", amount: 100, evidenceId: "invoice-1" }),
    reconcile(store, row.attemptId, { kind: "charged", amount: 200, evidenceId: "invoice-2" }),
  ]);
  assert.equal(attempt(store.snapshot()).confirmedCharge, 200);
  assert.equal(attempt(store.snapshot()).financialState, "DISPUTED");
  assert.equal(budgetStatus(store.snapshot()).committedMicros, row.reservationAmount);
});

test("idempotency binds content, context, history and key within a session", async () => {
  const { provider, prompts } = monitored();
  const service = createConversationService({ store: createSimulationStore(budget), provider });
  await service.execute("session-a", turn());
  const illicit = [
    turn("turn-2", { idempotencyKey: "key-turn-1" }),
    turn("turn-1", { idempotencyKey: "other-key" }),
    turn("turn-1", { context: bedrock }),
    turn("turn-1", { message: "Como testo a organização do sinal de redstone?" }),
    turn("turn-1", { history: ["another-turn"] }),
  ];
  for (const input of illicit) {
    const { result } = await service.execute("session-a", input);
    assert.equal(result.type === "ERROR" && result.error.code, "IDEMPOTENCY_CONFLICT");
  }
  const foreignHistory = await service.execute(
    "session-b",
    turn("another", { history: ["turn-1"] }),
  );
  assert.equal(
    foreignHistory.result.type === "ERROR" && foreignHistory.result.error.code,
    "INVALID_HISTORY",
  );
  const separate = await service.execute("session-b", turn());
  assert.equal(separate.event.replayed, false);
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1].history, []);
});

for (const [scenario, financialState] of [
  ["invalid-response", "SETTLED"],
  ["unknown-usage", "UNCERTAIN"],
  ["false-verification", "SETTLED"],
  ["invented-source", "SETTLED"],
  ["unsafe-content", "SETTLED"],
] as const) {
  test(`the response guard rejects ${scenario} and accounts for the usage independently`, async () => {
    const store = createSimulationStore(budget);
    const service = createConversationService({ store, provider: createMockProvider(scenario) });
    const { result, event } = await service.execute("session", turn());
    assert.equal(event.model, MOCK_MODEL);
    assert.equal(result.type === "ERROR" && result.error.code, "INVALID_PROVIDER_RESPONSE");
    assert.equal(attempt(store.snapshot()).financialState, financialState);
    assert.ok(!JSON.stringify(result).includes("example.invalid"));
  });
}

test("the provider's unavailable response is an explicitly simulated business outcome", async () => {
  const service = createConversationService({
    store: createSimulationStore(budget),
    provider: createMockProvider("unavailable"),
  });
  const { result } = await service.execute("session", turn());
  assert.equal(result.type, "UNAVAILABLE");
  if (result.type !== "UNAVAILABLE") assert.fail();
  assert.equal(result.origin, "MODEL");
  assert.equal(result.simulated, true);
  assert.equal(result.reason, "SIMULATOR_UNAVAILABLE");
});

test("abort before dispatch releases the reservation; abort during dispatch preserves uncertainty", async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    const store = createSimulationStore(budget);
    const base = createMockProvider();
    const provider: ModelAdapter = {
      id: MOCK_MODEL,
      invoke(prompt, signal) {
        controller.abort();
        return base.invoke(prompt, signal);
      },
    };
    const service = createConversationService({
      store,
      provider,
      checkpoint(stage) {
        if (before && stage === "after-reservation") controller.abort();
      },
    });
    const { result, event } = await service.execute(
      "session",
      turn(),
      undefined,
      controller.signal,
    );
    assert.equal(result.type === "ERROR" && result.error.code, "CANCELLED");
    assert.equal(event.outcome, "cancelled");
    assert.equal(event.model, before ? undefined : MOCK_MODEL);
    assert.equal(attempt(store.snapshot()).financialState, before ? "RELEASED" : "UNCERTAIN");
  }
});

test("allowlisted observability logs elapsed time without content, session, keys or exceptions", async () => {
  const emitted: unknown[] = [];
  let time = 0;
  const service = createConversationService({
    store: createSimulationStore(budget),
    provider: createMockProvider("transport-error"),
    clock: { wall: () => 100, monotonic: () => (time += 10) },
    emit(event) {
      emitted.push(event);
      throw new Error("sensitive-sink-error");
    },
  });
  const { event, result } = await service.execute("sensitive-session", turn());
  assert.equal(event.elapsedMs, 10);
  assert.equal(event.startedAt, 100);
  assert.equal(result.type, "ERROR");
  const json = JSON.stringify(emitted);
  for (const hidden of [
    "sensitive-session",
    "sensitive-sink-error",
    question,
    "key-turn-1",
    "context",
    "stack",
  ]) {
    assert.ok(!json.includes(hidden), hidden);
  }
});
