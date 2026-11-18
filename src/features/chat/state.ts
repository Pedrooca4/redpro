import { sameContext, type AssistantReply, type FollowUp } from "../assistant/contracts.ts";
import {
  isGameVersion,
  MESSAGE_LIMIT,
  type MinecraftContext,
  type Edition,
  type Mode,
} from "./config.ts";

export { MESSAGE_LIMIT } from "./config.ts";
type PlayerMessage = { id: number; text: string; context: MinecraftContext };
export type LocalMessage = PlayerMessage & { reply: AssistantReply };
type PendingMessage = PlayerMessage & { followUp?: FollowUp; simulateFailure: boolean };

const replyNotice: Record<AssistantReply["type"], string> = {
  ANSWER: "Orientação guiada.",
  CLARIFICATION: "Pergunta de esclarecimento.",
  UNSUPPORTED: "Pedido fora do limite do catálogo.",
};

export type ChatState = {
  context: MinecraftContext;
  draft: string;
  messages: LocalMessage[];
  pending: PendingMessage | null;
  nextRequestId: number;
  phase: "idle" | "sending" | "error";
  versionError: string | null;
  composerError: { kind: "message" | "request"; text: string } | null;
  notice: string;
};
export function initialChatState(): ChatState {
  return {
    context: { edition: "JAVA", game_version: null, mode: "RED" },
    draft: "",
    messages: [],
    pending: null,
    nextRequestId: 1,
    phase: "idle",
    versionError: null,
    composerError: null,
    notice: "",
  };
}
export type ChatAction =
  | { type: "draft"; value: string }
  | { type: "edition"; value: Edition }
  | { type: "version"; value: string | null }
  | { type: "mode"; value: Mode }
  | { type: "prepare"; text: string; mode: Mode }
  | { type: "submit"; simulateFailure?: boolean }
  | { type: "complete"; id: number; reply: AssistantReply }
  | { type: "fail"; id: number }
  | { type: "new" };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "new")
    return {
      ...initialChatState(),
      context: state.context,
      nextRequestId: state.nextRequestId,
      notice: "Nova conversa local. As preferências de edição, versão e modo foram mantidas.",
    };
  if (state.phase === "sending" && action.type !== "complete" && action.type !== "fail")
    return state;
  switch (action.type) {
    case "draft":
      return { ...state, draft: action.value, composerError: null, phase: "idle" };
    case "prepare":
      return {
        ...state,
        draft: action.text,
        context: { ...state.context, mode: action.mode },
        composerError: null,
        phase: "idle",
      };
    case "edition":
    case "version": {
      if (action.type === "version" && action.value !== null && !isGameVersion(action.value)) {
        if (state.versionError && !state.notice) return state;
        return {
          ...state,
          versionError:
            state.versionError ??
            "Informe uma versão numérica, como 1.21.1, ou deixe a versão não informada.",
          notice: "",
        };
      }
      const changed =
        action.type === "edition"
          ? state.context.edition !== action.value
          : state.context.game_version !== action.value;
      if (!changed) {
        if (action.type === "version" && state.versionError)
          return { ...state, versionError: null };
        return state;
      }
      return {
        ...state,
        context:
          action.type === "edition"
            ? { ...state.context, edition: action.value, game_version: null }
            : { ...state.context, game_version: action.value },
        versionError: null,
        notice: state.messages.length
          ? "Contexto alterado: orientações anteriores podem perder validade. As mensagens locais mantêm a edição e a versão de envio."
          : action.type === "edition"
            ? "Edição alterada. Escolha a versão correspondente; seu rascunho foi mantido."
            : "Versão atualizada; seu rascunho foi mantido.",
      };
    }
    case "mode":
      return { ...state, context: { ...state.context, mode: action.value } };
    case "submit": {
      const text = state.draft.trim();
      if (!text || text.length > MESSAGE_LIMIT)
        return {
          ...state,
          composerError: {
            kind: "message",
            text: `Escreva uma mensagem de 1 a ${MESSAGE_LIMIT} caracteres. Seu rascunho foi preservado.`,
          },
          phase: "error",
        };
      const last = state.messages.at(-1)?.reply;
      const followUp =
        last?.type === "CLARIFICATION" && sameContext(last.context, state.context)
          ? last.followUp
          : undefined;
      return {
        ...state,
        pending: {
          id: state.nextRequestId,
          text,
          context: { ...state.context },
          followUp,
          simulateFailure: action.simulateFailure ?? false,
        },
        nextRequestId: state.nextRequestId + 1,
        composerError: null,
        phase: "sending",
      };
    }
    case "complete": {
      if (state.pending?.id !== action.id) return state;
      const { id, text, context } = state.pending;
      return {
        ...state,
        messages: [...state.messages, { id, text, context, reply: action.reply }],
        pending: null,
        draft: "",
        phase: "idle",
        notice: `Resposta ${state.messages.length + 1}. ${replyNotice[action.reply.type]}`,
      };
    }
    case "fail":
      if (state.pending?.id !== action.id) return state;
      return {
        ...state,
        pending: null,
        phase: "error",
        composerError: {
          kind: "request",
          text: state.pending.simulateFailure
            ? "Falha simulada: sua mensagem foi preservada. Tente novamente."
            : "Não foi possível consultar o assistente. Sua mensagem foi preservada. Tente novamente.",
        },
      };
  }
}
