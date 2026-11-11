import { isGameVersion, MODES, type MinecraftContext } from "./config.ts";

export const AI_LIMITS = {
  messageCharacters: 4000,
  historyMessages: 8,
  contextCharacters: 12000,
  outputTokens: 800,
  answerCharacters: 12000,
  requestBytes: 64000,
  providerTimeoutMs: 20000,
} as const;

export type AIMessage = { role: "user" | "assistant"; content: string };
export type AIRequest = { context: MinecraftContext; messages: AIMessage[] };
export type AIReply = { text: string; truncated: boolean };
export const AI_ERRORS = {
  UNAVAILABLE: "A IA está indisponível no momento. A calculadora continua disponível.",
  BUDGET_EXHAUSTED:
    "A avaliação da IA está pausada por limite de uso. A calculadora continua disponível.",
  INVALID_INPUT: "Revise a pergunta e o contexto. Use até 4.000 caracteres por mensagem.",
  RATE_LIMITED: "O limite de perguntas foi atingido. Aguarde antes de tentar novamente.",
  TIMEOUT: "A resposta demorou além do limite. Sua pergunta foi preservada. Tente novamente.",
  PROVIDER_FAILED: "Não foi possível obter a resposta agora. Sua pergunta foi preservada.",
  FORBIDDEN: "Não foi possível autorizar esta solicitação. Reabra o chat e tente novamente.",
} as const;
export type AIErrorCode = keyof typeof AI_ERRORS;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Client history is untrusted context. No system roles, tools or model options are accepted.
export function parseAIRequest(value: unknown): AIRequest | null {
  if (!object(value) || Object.keys(value).some((key) => !["context", "messages"].includes(key)))
    return null;
  const { context, messages } = value;
  if (
    !object(context) ||
    Object.keys(context).some((key) => !["edition", "game_version", "mode"].includes(key)) ||
    (context.edition !== "JAVA" && context.edition !== "BEDROCK") ||
    !MODES.some((mode) => mode.id === context.mode) ||
    (context.game_version !== null &&
      (typeof context.game_version !== "string" || !isGameVersion(context.game_version))) ||
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > AI_LIMITS.historyMessages + 1 ||
    messages.length % 2 !== 1
  )
    return null;
  const parsed: AIMessage[] = [];
  for (const [index, message] of messages.entries()) {
    if (
      !object(message) ||
      Object.keys(message).some((key) => !["role", "content"].includes(key)) ||
      message.role !== (index % 2 === 0 ? "user" : "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length >
        (message.role === "user" ? AI_LIMITS.messageCharacters : AI_LIMITS.answerCharacters)
    )
      return null;
    parsed.push({ role: index % 2 === 0 ? "user" : "assistant", content: message.content.trim() });
  }
  if (
    parsed.reduce((total, message) => total + message.content.length, 0) >
    AI_LIMITS.contextCharacters
  )
    return null;
  return { context: context as MinecraftContext, messages: parsed };
}

export function buildAIHistory(history: readonly AIMessage[], question: string): AIMessage[] {
  const messages: AIMessage[] = [{ role: "user", content: question }];
  let size = question.length;
  // Include whole turns only. Never send a dangling assistant message.
  for (
    let i = history.length - 2;
    i >= 0 && messages.length < AI_LIMITS.historyMessages + 1;
    i -= 2
  ) {
    const user = history[i],
      assistant = history[i + 1];
    if (!user || !assistant || user.role !== "user" || assistant.role !== "assistant") break;
    size += user.content.length + assistant.content.length;
    if (size > AI_LIMITS.contextCharacters) break;
    messages.unshift(user, assistant);
  }
  return messages;
}

export function parseAIReply(value: unknown): AIReply | null {
  if (
    !object(value) ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    value.text.length > AI_LIMITS.answerCharacters ||
    typeof value.truncated !== "boolean"
  )
    return null;
  return { text: value.text, truncated: value.truncated };
}
