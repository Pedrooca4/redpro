import type { MinecraftContext } from "../../chat/config.ts";
import { estimateBlocks, MAX_DIMENSION } from "../../materials/calculations.ts";
import {
  isAssistantReply,
  parseAssistantRequest,
  type Answer,
  type FollowUp,
} from "../contracts.ts";

export const CONTRACT_VERSION = "1.0";
export const MAX_HISTORY = 6;
export const CONVERSATION_PATH = "/api/assistant/conversation";
export type Route = "DETERMINISTIC" | "MODEL" | "CLARIFICATION" | "UNAVAILABLE";

export type ConversationInput = {
  turnId: string;
  idempotencyKey: string;
  message: string;
  context: MinecraftContext;
  history: readonly string[];
};

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function parseConversationInput(value: unknown): ConversationInput | null {
  if (
    !record(value) ||
    !only(value, ["turnId", "idempotencyKey", "message", "context", "history"]) ||
    !isIdentifier(value.turnId) ||
    !isIdentifier(value.idempotencyKey)
  )
    return null;
  const assistant = parseAssistantRequest({ message: value.message, context: value.context });
  const history = value.history === undefined ? [] : value.history;
  if (
    !assistant ||
    !Array.isArray(history) ||
    history.length > MAX_HISTORY ||
    !history.every(isIdentifier) ||
    history.includes(value.turnId) ||
    new Set(history).size !== history.length
  )
    return null;
  return {
    turnId: value.turnId,
    idempotencyKey: value.idempotencyKey,
    message: assistant.message,
    context: {
      edition: assistant.context.edition,
      game_version: assistant.context.game_version,
      mode: assistant.context.mode,
    },
    history: [...history],
  };
}

const errors = {
  INVALID_INPUT: [400, "Confira os campos e o contexto da solicitação.", false],
  INVALID_JSON: [400, "O corpo precisa ser um JSON válido.", false],
  INVALID_HISTORY: [400, "Use turnos concluídos desta sessão em ordem cronológica.", false],
  IDEMPOTENCY_CONFLICT: [400, "O turno ou a chave já corresponde a outra solicitação.", false],
  PAYLOAD_TOO_LARGE: [413, "O corpo excede o limite permitido.", false],
  UNSUPPORTED_MEDIA_TYPE: [415, "Envie a solicitação em JSON.", false],
  RATE_LIMITED: [429, "O limite de simulação desta instância foi atingido.", false],
  INVALID_PROVIDER_RESPONSE: [502, "A resposta simulada não pôde ser validada.", false],
  TRANSPORT_ERROR: [503, "A chamada simulada falhou. O resultado financeiro é incerto.", false],
  CANCELLED: [503, "O processamento da solicitação foi cancelado.", false],
  INTERNAL_ERROR: [503, "A conversa não pôde ser processada.", false],
  PROVIDER_TIMEOUT: [
    504,
    "A chamada simulada excedeu o prazo. O resultado financeiro é incerto.",
    false,
  ],
} as const satisfies Record<string, readonly [number, string, boolean]>;

const unavailableMessages = {
  FEATURE_DISABLED: "A conversa simulada está desativada neste ambiente.",
  PROVIDER_NOT_AUTHORIZED: "Nenhum provedor está autorizado para esta simulação.",
  BUDGET_UNAVAILABLE: "O orçamento virtual não comporta esta solicitação.",
  BUDGET_DISPUTED: "Uma divergência financeira da simulação requer conciliação.",
  EVIDENCE_INSUFFICIENT: "Não há evidência suficiente no catálogo para orientar esse pedido.",
  SIMULATOR_UNAVAILABLE: "O provedor fictício está indisponível para este cenário.",
  SESSION_REQUIRED:
    "A sessão local foi iniciada. Envie a pergunta novamente com o cookie da sessão.",
  ATTEMPT_PENDING: "A tentativa deste turno continua em processamento.",
  ATTEMPT_UNCERTAIN: "O resultado desta tentativa é incerto e aguarda conciliação.",
  RESULT_UNAVAILABLE: "A tentativa foi encerrada sem uma resposta que possa ser recuperada.",
} as const;

export type ErrorCode = keyof typeof errors;
export type UnavailableReason = keyof typeof unavailableMessages;
export type ErrorResult = {
  type: "ERROR";
  error: { code: ErrorCode; message: string; retryable: boolean };
};

export type Calculation = {
  ruleId: "estimateBlocks:platform" | "estimateBlocks:walls";
  inputs: { length: number; width: number; height: number };
  formula: string;
  assumptions: readonly string[];
  result: number;
  unit: "blocos";
  estimated: boolean;
};

export type Verified = {
  type: "VERIFIED";
  origin: "DETERMINISTIC";
  text: string;
  procedureId: Answer["procedureId"];
  answer: Answer["answer"];
  sources: Answer["sources"];
  limitations: readonly string[];
  evidence: { kind: "DOCUMENTED" } | { kind: "CALCULATED"; calculations: readonly Calculation[] };
};

type Hypothesis = {
  type: "HYPOTHESIS";
  origin: "MODEL";
  text: string;
  simulated: true;
  sources: readonly [];
  limitations: readonly string[];
};

type Clarification = {
  type: "CLARIFICATION";
  origin: "SYSTEM" | "DETERMINISTIC" | "MODEL";
  text: string;
  needsVersion?: true;
  followUp?: FollowUp;
  simulated?: true;
};

type Unavailable = {
  type: "UNAVAILABLE";
  origin: "SYSTEM" | "MODEL";
  text: string;
  reason: UnavailableReason;
  simulated?: true;
};

export type ConversationResult = Verified | Hypothesis | Clarification | Unavailable | ErrorResult;
export type ConversationResponse = { contractVersion: string; requestId: string } & (
  | (ErrorResult & { turnId?: string; context?: MinecraftContext })
  | (Exclude<ConversationResult, ErrorResult> & { turnId: string; context: MinecraftContext })
);

export function failure(code: ErrorCode): ErrorResult {
  const [, message, retryable] = errors[code];
  return { type: "ERROR", error: { code, message, retryable } };
}

export function unavailable(reason: UnavailableReason): Unavailable {
  const text = unavailableMessages[reason];
  return reason === "SIMULATOR_UNAVAILABLE"
    ? { type: "UNAVAILABLE", origin: "MODEL", reason, text, simulated: true }
    : { type: "UNAVAILABLE", origin: "SYSTEM", reason, text };
}

export function isPublicText(value: unknown, limit = 1000): value is string {
  return typeof value === "string" && value.length <= limit && value.trim().length > 0;
}

function isTextList(value: unknown, minimum = 0): boolean {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= 12 &&
    value.every((item) => isPublicText(item))
  );
}

function isCalculation(value: unknown): boolean {
  if (
    !record(value) ||
    !only(value, ["ruleId", "inputs", "formula", "assumptions", "result", "unit", "estimated"]) ||
    !record(value.inputs) ||
    !only(value.inputs, ["length", "width", "height"]) ||
    ![value.inputs.length, value.inputs.width, value.inputs.height].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_DIMENSION,
    ) ||
    !isPublicText(value.formula) ||
    !isTextList(value.assumptions, 1) ||
    value.unit !== "blocos" ||
    typeof value.estimated !== "boolean"
  )
    return false;
  const { length, width, height } = value.inputs as Calculation["inputs"];
  if (value.ruleId === "estimateBlocks:platform")
    return (
      height === 1 &&
      value.result === estimateBlocks("platform", { length, width }) &&
      !value.estimated
    );
  return (
    value.ruleId === "estimateBlocks:walls" &&
    length >= 2 &&
    width >= 2 &&
    value.result === estimateBlocks("walls", { length, width, height }) &&
    value.estimated
  );
}

export function isConversationResult(
  value: unknown,
  context?: MinecraftContext,
): value is ConversationResult {
  if (!record(value)) return false;
  if (value.type === "ERROR") {
    if (
      !only(value, ["type", "error"]) ||
      !record(value.error) ||
      !only(value.error, ["code", "message", "retryable"]) ||
      typeof value.error.code !== "string" ||
      !Object.hasOwn(errors, value.error.code)
    )
      return false;
    const [, message, retryable] = errors[value.error.code as ErrorCode];
    return value.error.message === message && value.error.retryable === retryable;
  }
  if (!context || !isPublicText(value.text)) return false;
  switch (value.type) {
    case "VERIFIED": {
      if (
        !only(value, [
          "type",
          "origin",
          "text",
          "procedureId",
          "answer",
          "sources",
          "limitations",
          "evidence",
        ]) ||
        value.origin !== "DETERMINISTIC" ||
        !isTextList(value.limitations) ||
        !record(value.evidence) ||
        !isAssistantReply({
          type: "ANSWER",
          context,
          procedureId: value.procedureId,
          answer: value.answer,
          sources: value.sources,
          verification: value.evidence.kind,
        }) ||
        !record(value.answer) ||
        value.answer.text !== value.text
      )
        return false;
      if (value.evidence.kind === "DOCUMENTED") return only(value.evidence, ["kind"]);
      const calculations = value.evidence.calculations;
      return (
        only(value.evidence, ["kind", "calculations"]) &&
        Array.isArray(calculations) &&
        calculations.length >= 1 &&
        calculations.length <= 8 &&
        calculations.every(isCalculation)
      );
    }
    case "HYPOTHESIS":
      return (
        only(value, ["type", "origin", "text", "simulated", "sources", "limitations"]) &&
        value.origin === "MODEL" &&
        value.simulated === true &&
        value.text.startsWith("Simulação D1. ") &&
        Array.isArray(value.sources) &&
        value.sources.length === 0 &&
        isTextList(value.limitations, 1)
      );
    case "CLARIFICATION":
      return (
        only(value, ["type", "origin", "text", "simulated", "needsVersion", "followUp"]) &&
        (value.origin === "MODEL"
          ? value.simulated === true &&
            value.text.startsWith("Simulação D1. ") &&
            value.needsVersion === undefined &&
            value.followUp === undefined
          : (value.origin === "SYSTEM" || value.origin === "DETERMINISTIC") &&
            value.simulated === undefined &&
            (value.origin !== "SYSTEM" || value.followUp === undefined) &&
            isAssistantReply({
              type: "CLARIFICATION",
              context,
              text: value.text,
              needsVersion: value.needsVersion,
              followUp: value.followUp,
            }))
      );
    case "UNAVAILABLE":
      return (
        only(value, ["type", "origin", "text", "reason", "simulated"]) &&
        typeof value.reason === "string" &&
        Object.hasOwn(unavailableMessages, value.reason) &&
        value.text === unavailableMessages[value.reason as UnavailableReason] &&
        (value.reason === "SIMULATOR_UNAVAILABLE"
          ? value.origin === "MODEL" && value.simulated === true
          : value.origin === "SYSTEM" && value.simulated === undefined)
      );
    default:
      return false;
  }
}

export function encodeResponse(
  requestId: string,
  result: ConversationResult,
  input?: ConversationInput,
) {
  const validated = isConversationResult(result, input?.context)
    ? result
    : failure("INTERNAL_ERROR");
  const envelope = {
    contractVersion: CONTRACT_VERSION,
    requestId,
    ...(input && { turnId: input.turnId, context: input.context }),
    ...validated,
  } as ConversationResponse;
  return { envelope, status: validated.type === "ERROR" ? errors[validated.error.code][0] : 200 };
}
