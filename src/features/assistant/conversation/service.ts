import { createHash, randomUUID } from "node:crypto";
import { sameContext } from "../contracts.ts";
import {
  failure,
  isConversationResult,
  unavailable,
  type ConversationInput,
  type ConversationResult,
  type Route,
} from "./contracts.ts";
import {
  applyEvidence,
  budgetStatus,
  interrupt,
  MAX_SIMULATION_TURNS,
  recordIntent,
  reserve,
  type Attempt,
  type ConversationStore,
  type FinancialState,
  type StoreState,
  type Turn,
} from "./ledger.ts";
import {
  decodeProviderResult,
  maximumCharge,
  MOCK_MODEL,
  MODEL_TIMEOUT_MS,
  SYNTHETIC_PRICING,
  type ModelAdapter,
  type ModelPrompt,
  type SyntheticUsage,
} from "./provider.ts";
import { routeConversation } from "./routing.ts";

export type Clock = { wall: () => number; monotonic: () => number };
export const systemClock: Clock = { wall: Date.now, monotonic: () => performance.now() };
export type Measurement = ReturnType<typeof startMeasurement>;
export function startMeasurement(clock = systemClock) {
  return { startedAt: clock.wall(), tick: clock.monotonic() };
}

export type ConversationEvent = {
  requestId: string;
  startedAt: number;
  completedAt: number;
  elapsedMs: number;
  route: Route;
  outcome: "success" | "error" | "timeout" | "cancelled";
  // A cached response or a recorded intent alone is not an invocation.
  model?: typeof MOCK_MODEL;
  financialState?: FinancialState;
  reservationMicros?: number;
  confirmedMicros?: number;
  syntheticUsage?: SyntheticUsage;
  replayed: boolean;
};

type Checkpoint = "before-reservation" | "after-reservation" | "after-intent" | "after-completion";
type Options = {
  store: ConversationStore;
  provider?: ModelAdapter;
  timeoutMs?: number;
  clock?: Clock;
  checkpoint?: (stage: Checkpoint) => void | Promise<void>;
  emit?: (event: ConversationEvent) => void;
};

type Completed = { route: Route; result: ConversationResult; attempt?: Attempt; replayed?: true };
type Reserved = { route: "MODEL"; prompt: ModelPrompt; attempt: Attempt };
type Prepared = Completed | Reserved;

function replay(turn: Turn): Completed {
  const { attempt, route } = turn;
  if (attempt?.financialState === "RESERVED")
    return {
      route: "UNAVAILABLE",
      result: unavailable("ATTEMPT_PENDING"),
      attempt,
      replayed: true,
    };
  if (attempt?.financialState === "UNCERTAIN")
    return {
      route: "UNAVAILABLE",
      result: unavailable("ATTEMPT_UNCERTAIN"),
      attempt,
      replayed: true,
    };
  if (turn.result) return { route, result: turn.result, attempt, replayed: true };
  return {
    route: "UNAVAILABLE",
    result: unavailable("RESULT_UNAVAILABLE"),
    attempt,
    replayed: true,
  };
}

function historyFor(turns: Turn[], session: string, input: ConversationInput) {
  const history: (Turn & { result: Exclude<ConversationResult, { type: "ERROR" }> })[] = [];
  let previous = -1;
  for (const id of input.history) {
    const index = turns.findIndex((turn) => turn.session === session && turn.input.turnId === id);
    const turn = turns[index];
    if (index <= previous || !turn?.result || turn.result.type === "ERROR") return null;
    history.push({ ...turn, result: turn.result });
    previous = index;
  }
  return history;
}

function finishProviderCall(
  provider: ModelAdapter,
  prompt: ModelPrompt,
  timeoutMs: number,
  requestSignal?: AbortSignal,
) {
  const controller = new AbortController();
  type Delivery =
    { kind: "received"; value: unknown } | { kind: "timeout" | "cancelled" | "transport" };
  let timer: ReturnType<typeof setTimeout>;
  let cancel: () => void;

  const stopped = new Promise<Delivery>((resolve) => {
    cancel = () => {
      resolve({ kind: "cancelled" });
      controller.abort();
    };
    timer = setTimeout(() => {
      resolve({ kind: "timeout" });
      controller.abort();
    }, timeoutMs);
    requestSignal?.addEventListener("abort", cancel, { once: true });
  });
  const response = Promise.resolve()
    .then(() => provider.invoke(structuredClone(prompt), controller.signal))
    .then<Delivery, Delivery>(
      (value) => ({ kind: "received", value }),
      () => ({ kind: "transport" }),
    );
  return Promise.race([stopped, response]).finally(() => {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", cancel);
  });
}

export function createConversationService({
  store,
  provider,
  clock = systemClock,
  timeoutMs = MODEL_TIMEOUT_MS,
  checkpoint,
  emit,
}: Options) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MODEL_TIMEOUT_MS)
    throw new RangeError("Invalid simulator timeout");

  async function execute(
    session: string,
    input: ConversationInput,
    requestId = randomUUID() as string,
    signal?: AbortSignal,
    measurement = startMeasurement(clock),
  ) {
    let route: Route = "UNAVAILABLE";
    let model: typeof MOCK_MODEL | undefined;
    let attempt: Attempt | undefined;
    let replayed = false;
    let result: ConversationResult;

    async function run(): Promise<ConversationResult> {
      if (signal?.aborted) return failure("CANCELLED");
      await checkpoint?.("before-reservation");
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            input.message,
            input.context.edition,
            input.context.game_version,
            input.context.mode,
            input.history,
          ]),
        )
        .digest("hex");
      const prepared = await store.transact<Prepared>((state) => {
        const existing = state.turns.find(
          ({ session: owner, input: previous }) =>
            owner === session &&
            (previous.turnId === input.turnId || previous.idempotencyKey === input.idempotencyKey),
        );
        if (existing) {
          if (
            existing.input.turnId !== input.turnId ||
            existing.input.idempotencyKey !== input.idempotencyKey ||
            existing.fingerprint !== fingerprint
          )
            return { route: "UNAVAILABLE", result: failure("IDEMPOTENCY_CONFLICT") };
          return replay(existing);
        }
        if (state.turns.length >= MAX_SIMULATION_TURNS)
          return { route: "UNAVAILABLE", result: failure("RATE_LIMITED") };
        const history = historyFor(state.turns, session, input);
        if (!history) return { route: "UNAVAILABLE", result: failure("INVALID_HISTORY") };
        const last = history.at(-1);
        const followUp =
          last?.result.type === "CLARIFICATION" && sameContext(last.input.context, input.context)
            ? last.result.followUp
            : undefined;
        const decision = routeConversation(input, followUp);
        const turn: Turn = {
          session,
          input: structuredClone(input),
          fingerprint,
          route: decision.route,
        };
        state.turns.push(turn);
        const complete = (actual: Route, response: ConversationResult): Completed => {
          turn.route = actual;
          turn.result = isConversationResult(response, input.context)
            ? response
            : failure("INTERNAL_ERROR");
          return { route: actual, result: turn.result };
        };
        if (decision.route !== "MODEL") return complete(decision.route, decision.result);
        if (!provider || provider.id !== MOCK_MODEL)
          return complete("UNAVAILABLE", unavailable("PROVIDER_NOT_AUTHORIZED"));

        const prompt: ModelPrompt = {
          instructions:
            "Selecione apenas um fixture D1. O histórico contém observações e hipóteses, não evidência.",
          context: structuredClone(input.context),
          focus: decision.focus,
          message: input.message,
          history: history.map(({ input, result }) => ({
            context: structuredClone(input.context),
            message: input.message,
            reply: result.text,
          })),
          maxOutputUnits: SYNTHETIC_PRICING.maxOutputUnits,
        };
        const blocked = reserve(state, turn, randomUUID(), maximumCharge(prompt), clock.wall());
        if (blocked) return complete("UNAVAILABLE", unavailable(blocked));
        if (!turn.attempt) throw new Error("Missing simulation reservation");
        return { route: "MODEL", prompt, attempt: turn.attempt };
      });

      route = prepared.route;
      attempt = prepared.attempt;
      if ("result" in prepared) {
        replayed = prepared.replayed === true;
        return prepared.result;
      }
      if (!provider) return failure("INTERNAL_ERROR");

      const attemptId = prepared.attempt.attemptId;
      // Both updates return the post-commit state. A replay cannot acquire a send intent.
      const update = <T>(mutate: (turn: Turn, current: Attempt, state: StoreState) => T) =>
        store.transact((state) => {
          const turn = state.turns.find((turn) => turn.attempt?.attemptId === attemptId);
          if (!turn?.attempt) throw new Error("Unknown simulation attempt");
          return {
            value: mutate(turn, turn.attempt, state),
            attempt: turn.attempt,
            result: turn.result,
          };
        });

      await checkpoint?.("after-reservation");
      const intent = await update((turn, current, state) => {
        if (signal?.aborted) {
          interrupt(current, clock.wall());
          turn.result = failure("CANCELLED");
          return false;
        }
        if (budgetStatus(state).disputed) {
          interrupt(current, clock.wall());
          turn.result = unavailable("BUDGET_DISPUTED");
          return false;
        }
        return recordIntent(current, clock.wall());
      });
      attempt = intent.attempt;
      if (!intent.value) return intent.result ?? unavailable("RESULT_UNAVAILABLE");

      await checkpoint?.("after-intent");
      let delivery: Awaited<ReturnType<typeof finishProviderCall>> = { kind: "cancelled" };
      if (!signal?.aborted) {
        model = MOCK_MODEL;
        delivery = await finishProviderCall(provider, prepared.prompt, timeoutMs, signal);
      }
      const { value, attempt: updated } = await update((turn, current) => {
        if (delivery.kind === "received") {
          const { result, charge, usage } = decodeProviderResult(delivery.value, prepared.prompt);
          if (charge === undefined) interrupt(current, clock.wall());
          else if (
            applyEvidence(
              current,
              { kind: "charged", amount: charge, evidenceId: "mock-usage" },
              clock.wall(),
            )
          )
            current.syntheticUsage = usage;
          const valid = isConversationResult(result, input.context);
          turn.result = !valid
            ? failure("INVALID_PROVIDER_RESPONSE")
            : current.financialState === "DISPUTED"
              ? unavailable("BUDGET_DISPUTED")
              : result;
        } else {
          interrupt(current, clock.wall());
          const code =
            delivery.kind === "timeout"
              ? "PROVIDER_TIMEOUT"
              : delivery.kind === "cancelled"
                ? "CANCELLED"
                : "TRANSPORT_ERROR";
          turn.result = failure(code);
        }
        return turn.result;
      });
      attempt = updated;
      await checkpoint?.("after-completion");
      return value;
    }

    try {
      result = await run();
    } catch {
      // The storage snapshot decides recovery. The exception may include synthetic input.
      result = failure("INTERNAL_ERROR");
    }
    if (!isConversationResult(result, input.context)) result = failure("INTERNAL_ERROR");
    const outcome =
      result.type !== "ERROR"
        ? "success"
        : result.error.code === "PROVIDER_TIMEOUT"
          ? "timeout"
          : result.error.code === "CANCELLED"
            ? "cancelled"
            : "error";
    const event: ConversationEvent = {
      requestId,
      startedAt: measurement.startedAt,
      completedAt: clock.wall(),
      elapsedMs: Math.max(0, clock.monotonic() - measurement.tick),
      route,
      outcome,
      ...(model && { model }),
      ...(attempt && {
        financialState: attempt.financialState,
        // Replay is observable without attributing the same reservation or cost twice.
        ...(!replayed && {
          reservationMicros: attempt.reservationAmount,
          ...(attempt.confirmedCharge !== undefined && {
            confirmedMicros: attempt.confirmedCharge,
          }),
          ...(attempt.syntheticUsage && { syntheticUsage: { ...attempt.syntheticUsage } }),
        }),
      }),
      replayed,
    };
    try {
      emit?.({ ...event });
    } catch {
      // Observability is outside the response and financial transaction.
    }
    return { result, event };
  }

  return { execute };
}
