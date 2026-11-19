import {
  isIdentifier,
  only,
  record,
  type ConversationInput,
  type ConversationResult,
  type Route,
} from "./contracts.ts";
import { SYNTHETIC_PRICING, type SyntheticUsage } from "./provider.ts";

const MAX_MICROS = 1_000_000_000_000;
export const MAX_SIMULATION_TURNS = 256;

export type FinancialState = "RESERVED" | "SETTLED" | "RELEASED" | "UNCERTAIN" | "DISPUTED";
type FinancialEvent = {
  event: FinancialState | "SEND_INTENT";
  at: number;
  evidenceId?: string;
  confirmedCharge?: number;
  excessMicros?: number;
};

export type Attempt = {
  attemptId: string;
  turnId: string;
  idempotencyKey: string;
  pricingVersion: typeof SYNTHETIC_PRICING.version;
  reservationAmount: number;
  confirmedCharge?: number;
  syntheticUsage?: SyntheticUsage;
  financialState: FinancialState;
  sendIntentAt?: number;
  history: FinancialEvent[];
};

export type Turn = {
  session: string;
  input: ConversationInput;
  fingerprint: string;
  route: Route;
  result?: ConversationResult;
  attempt?: Attempt;
};

export type StoreState = { budgetMicros: number; turns: Turn[] };

export type ConversationStore = {
  // The adapter resolves only after an atomic commit, including the idempotency keys.
  transact: <T>(operation: (state: StoreState) => T) => Promise<T>;
};

export function createSimulationStore(initial: number | StoreState = 0) {
  let state: StoreState =
    typeof initial === "number" ? { budgetMicros: initial, turns: [] } : structuredClone(initial);
  if (!validAmount(state.budgetMicros)) throw new RangeError("Invalid virtual budget");

  return {
    async transact<T>(operation: (draft: StoreState) => T): Promise<T> {
      // Every callback is synchronous. Interleaved workers sharing this adapter see
      // either the previous committed snapshot or the next one, even across awaits.
      const draft = structuredClone(state);
      const result = structuredClone(operation(draft));
      state = draft;
      return result;
    },
    snapshot: () => structuredClone(state),
  };
}

function validAmount(amount: unknown): amount is number {
  return (
    typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    amount <= MAX_MICROS
  );
}

function commitment(attempt: Attempt): number {
  switch (attempt.financialState) {
    case "RELEASED":
      return 0;
    case "SETTLED":
      return attempt.confirmedCharge ?? 0;
    case "DISPUTED":
      return Math.max(attempt.reservationAmount, attempt.confirmedCharge ?? 0);
    default:
      return attempt.reservationAmount;
  }
}

export function budgetStatus(state: StoreState) {
  let committedMicros = 0;
  let settledMicros = 0;
  let uncertainMicros = 0;
  let disputedMicros = 0;
  let disputed = false;
  for (const { attempt } of state.turns) {
    if (!attempt) continue;
    const amount = commitment(attempt);
    committedMicros += amount;
    if (attempt.financialState === "SETTLED") settledMicros += amount;
    if (attempt.financialState === "UNCERTAIN") uncertainMicros += amount;
    if (attempt.financialState === "DISPUTED") {
      disputed = true;
      disputedMicros += amount;
    }
  }
  return {
    budgetMicros: state.budgetMicros,
    committedMicros,
    availableMicros: Math.max(0, state.budgetMicros - committedMicros),
    excessMicros: Math.max(0, committedMicros - state.budgetMicros),
    settledMicros,
    uncertainMicros,
    disputedMicros,
    disputed,
  };
}

export function reserve(
  state: StoreState,
  turn: Turn,
  attemptId: string,
  amount: number,
  now: number,
): "BUDGET_DISPUTED" | "BUDGET_UNAVAILABLE" | undefined {
  const account = budgetStatus(state);
  if (account.disputed) return "BUDGET_DISPUTED";
  if (!validAmount(amount) || amount === 0 || amount > account.availableMicros)
    return "BUDGET_UNAVAILABLE";

  turn.attempt = {
    attemptId,
    turnId: turn.input.turnId,
    idempotencyKey: turn.input.idempotencyKey,
    pricingVersion: SYNTHETIC_PRICING.version,
    reservationAmount: amount,
    financialState: "RESERVED",
    history: [{ event: "RESERVED", at: now }],
  };
}

export function recordIntent(attempt: Attempt, now: number): boolean {
  if (attempt.financialState !== "RESERVED" || attempt.sendIntentAt !== undefined) return false;
  attempt.sendIntentAt = now;
  attempt.history.push({ event: "SEND_INTENT", at: now });
  return true;
}

function transition(
  attempt: Attempt,
  event: FinancialState,
  at: number,
  evidenceId?: string,
  confirmedCharge?: number,
) {
  attempt.financialState = event;
  if (confirmedCharge !== undefined) attempt.confirmedCharge = confirmedCharge;
  attempt.history.push({
    event,
    at,
    ...(evidenceId && { evidenceId }),
    ...(confirmedCharge !== undefined && {
      confirmedCharge,
      excessMicros: Math.max(0, confirmedCharge - attempt.reservationAmount),
    }),
  });
}

export function interrupt(attempt: Attempt, now: number): void {
  if (attempt.financialState !== "RESERVED") return;
  transition(attempt, attempt.sendIntentAt === undefined ? "RELEASED" : "UNCERTAIN", now);
}

export function recoverInterrupted(store: ConversationStore, now = Date.now()) {
  // Call on a restarted simulator after the previous workers have stopped.
  return store.transact((state) => {
    for (const { attempt } of state.turns) {
      if (attempt) interrupt(attempt, now);
    }
  });
}

type Evidence =
  | { kind: "charged" | "dispute-reviewed"; evidenceId: string; amount: number }
  | { kind: "not-charged"; evidenceId: string };

function isEvidence(value: unknown): value is Evidence {
  if (!record(value) || !isIdentifier(value.evidenceId)) return false;
  if (value.kind === "not-charged") return only(value, ["kind", "evidenceId"]);
  return (
    (value.kind === "charged" || value.kind === "dispute-reviewed") &&
    only(value, ["kind", "evidenceId", "amount"]) &&
    validAmount(value.amount)
  );
}

export function applyEvidence(attempt: Attempt, evidence: unknown, now: number): boolean {
  if (
    attempt.sendIntentAt === undefined ||
    !isEvidence(evidence) ||
    attempt.history.some((event) => event.evidenceId === evidence.evidenceId)
  )
    return false;

  const amount = evidence.kind === "not-charged" ? 0 : evidence.amount;
  if (evidence.kind === "dispute-reviewed") {
    if (attempt.financialState !== "DISPUTED") return false;
    transition(attempt, "SETTLED", now, evidence.evidenceId, amount);
    return true;
  }

  if (attempt.confirmedCharge === amount) return false;
  const contradicted = attempt.confirmedCharge !== undefined;
  if (contradicted || amount > attempt.reservationAmount || attempt.financialState === "DISPUTED") {
    transition(
      attempt,
      "DISPUTED",
      now,
      evidence.evidenceId,
      Math.max(amount, attempt.confirmedCharge ?? 0),
    );
  } else {
    transition(
      attempt,
      evidence.kind === "not-charged" ? "RELEASED" : "SETTLED",
      now,
      evidence.evidenceId,
      amount,
    );
  }
  return true;
}

// Simulator operator only. The HTTP route has no reconciliation operation.
export function reconcile(
  store: ConversationStore,
  attemptId: string,
  evidence: unknown,
  now = Date.now(),
) {
  return store.transact(({ turns }) => {
    const attempt = turns.find((turn) => turn.attempt?.attemptId === attemptId)?.attempt;
    return attempt ? applyEvidence(attempt, evidence, now) : false;
  });
}
