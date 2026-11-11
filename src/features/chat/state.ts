import { isGameVersion, type MinecraftContext, type Edition, type Mode } from "./config.ts";
import { AI_ERRORS, type AIErrorCode, type AIReply } from "./ai-contract.ts";

export const MESSAGE_LIMIT = 4000;
export type LocalMessage = {
  id: number;
  text: string;
  context: MinecraftContext;
  role?: "user" | "assistant";
  truncated?: boolean;
};
export type ChatState = {
  context: MinecraftContext;
  draft: string;
  messages: LocalMessage[];
  pending: Omit<LocalMessage, "id"> | null;
  phase: "idle" | "previewing" | "error";
  error: string | null;
  notice: string;
};
export function initialChatState(): ChatState {
  return {
    context: { edition: "JAVA", game_version: null, mode: "RED" },
    draft: "",
    messages: [],
    pending: null,
    phase: "idle",
    error: null,
    notice: "",
  };
}
export type ChatAction =
  | { type: "draft"; value: string }
  | { type: "edition"; value: Edition }
  | { type: "version"; value: string | null }
  | { type: "mode"; value: Mode }
  | { type: "prepare"; text: string; mode: Mode }
  | { type: "submit" }
  | { type: "complete"; answer?: AIReply }
  | { type: "fail"; code?: AIErrorCode }
  | { type: "new" };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "new")
    return {
      ...initialChatState(),
      context: state.context,
      notice: "Nova conversa local. As preferências de edição, versão e modo foram mantidas.",
    };
  if (state.phase === "previewing" && action.type !== "complete" && action.type !== "fail")
    return state;
  switch (action.type) {
    case "draft":
      return { ...state, draft: action.value, error: null, phase: "idle" };
    case "prepare":
      return {
        ...state,
        draft: action.text,
        context: { ...state.context, mode: action.mode },
        error: null,
        phase: "idle",
      };
    case "edition":
    case "version": {
      const changed =
        action.type === "edition"
          ? state.context.edition !== action.value
          : state.context.game_version !== action.value;
      if (!changed) return state;
      if (action.type === "version" && action.value !== null && !isGameVersion(action.value))
        return {
          ...state,
          error: "Informe uma versão numérica, como 1.21.1, ou deixe a versão não informada.",
          phase: "error",
        };
      return {
        ...state,
        context:
          action.type === "edition"
            ? { ...state.context, edition: action.value, game_version: null }
            : { ...state.context, game_version: action.value },
        error: null,
        phase: "idle",
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
          error: `Escreva uma mensagem de 1 a ${MESSAGE_LIMIT} caracteres. Seu rascunho foi preservado.`,
          phase: "error",
        };
      return {
        ...state,
        pending: { text, context: { ...state.context } },
        error: null,
        phase: "previewing",
      };
    }
    case "complete":
      if (!state.pending) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            ...state.pending,
            id: state.messages.length + 1,
            ...(action.answer ? { role: "user" as const } : {}),
          },
          ...(action.answer
            ? [
                {
                  id: state.messages.length + 2,
                  text: action.answer.text,
                  context: state.pending.context,
                  role: "assistant" as const,
                  truncated: action.answer.truncated,
                },
              ]
            : []),
        ],
        pending: null,
        draft: "",
        phase: "idle",
        notice: action.answer
          ? "Resposta recebida da IA. O histórico desta sessão fica apenas nesta página."
          : "Mensagem exibida apenas nesta página. Nenhuma pergunta foi enviada a uma IA ou salva no servidor.",
      };
    case "fail":
      return {
        ...state,
        pending: null,
        phase: "error",
        error: action.code
          ? AI_ERRORS[action.code]
          : "Falha de demonstração: não foi possível concluir agora. Sua mensagem foi preservada. Tente novamente.",
      };
  }
}
