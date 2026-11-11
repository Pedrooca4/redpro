import { AI_ERRORS, type AIErrorCode } from "../../features/chat/ai-contract.ts";

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryAfter?: number;
  constructor(code: AIErrorCode, retryAfter?: number) {
    super(AI_ERRORS[code]);
    this.name = "AIError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function aiErrorResponse(error: unknown): Response {
  const safe = error instanceof AIError ? error : new AIError("PROVIDER_FAILED");
  const status = {
    UNAVAILABLE: 503,
    INVALID_INPUT: 400,
    RATE_LIMITED: 429,
    TIMEOUT: 504,
    PROVIDER_FAILED: 502,
    FORBIDDEN: 403,
  }[safe.code];
  return Response.json(
    { error: { code: safe.code, message: AI_ERRORS[safe.code] } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(safe.retryAfter ? { "Retry-After": String(safe.retryAfter) } : {}),
      },
    },
  );
}
