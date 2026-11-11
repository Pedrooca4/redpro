import {
  AI_ERRORS,
  parseAIReply,
  type AIRequest,
  type AIReply,
  type AIErrorCode,
} from "./ai-contract.ts";

export class ChatRequestError extends Error {
  readonly code: AIErrorCode;
  constructor(code: AIErrorCode) {
    super(AI_ERRORS[code]);
    this.code = code;
  }
}

export async function askMinepro(input: AIRequest, signal: AbortSignal): Promise<AIReply> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const code =
        response.status === 429
          ? "RATE_LIMITED"
          : response.status === 504
            ? "TIMEOUT"
            : response.status === 503
              ? "UNAVAILABLE"
              : "PROVIDER_FAILED";
      throw new ChatRequestError(code);
    }
    const reply = parseAIReply(await response.json());
    if (!reply) throw new ChatRequestError("PROVIDER_FAILED");
    return reply;
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
      throw new ChatRequestError("TIMEOUT");
    throw new ChatRequestError("PROVIDER_FAILED");
  }
}
