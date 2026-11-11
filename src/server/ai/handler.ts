import { AI_LIMITS, parseAIRequest } from "../../features/chat/ai-contract.ts";
import { readAIConfig, requesterKey, type AIConfig } from "./config.ts";
import { AIError, aiErrorResponse } from "./errors.ts";
import { createDurableGuard, type Admit } from "./guard.ts";
import { readLimitedJSON } from "./http.ts";
import { createGatewayProvider, type Generate } from "./provider.ts";

export function createChatHandler(
  dependencies: {
    config?: () => AIConfig | null;
    provider?: (config: AIConfig) => Generate;
    guard?: (config: AIConfig) => Admit;
  } = {},
) {
  return async (request: Request): Promise<Response> => {
    let release: (() => Promise<void>) | undefined;
    try {
      const config = (dependencies.config ?? readAIConfig)();
      if (!config) throw new AIError("UNAVAILABLE");
      const url = new URL(request.url);
      if (
        request.method !== "POST" ||
        url.protocol !== "https:" ||
        request.headers.get("origin") !== url.origin ||
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
      )
        throw new AIError("FORBIDDEN");
      const identity = requesterKey(request, config.rateSecret);
      const size = request.headers.get("content-length");
      if (size && (!/^\d+$/.test(size) || Number(size) > AI_LIMITS.requestBytes))
        throw new AIError("INVALID_INPUT");
      let body: unknown;
      try {
        body = await readLimitedJSON(
          request.body,
          AI_LIMITS.requestBytes,
          AbortSignal.any([request.signal, AbortSignal.timeout(2000)]),
        );
      } catch {
        throw new AIError("INVALID_INPUT");
      }
      const input = parseAIRequest(body);
      if (!input) throw new AIError("INVALID_INPUT");
      const admission = await (dependencies.guard ?? createDurableGuard)(config)(identity);
      release = admission.release;
      request.signal.throwIfAborted();
      const answer = await (dependencies.provider ?? createGatewayProvider)(config)(
        input,
        request.signal,
      );
      return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return aiErrorResponse(error);
    } finally {
      // If release fails, the bounded lease expires. Never retry or log a raw guard error.
      if (release) await release().catch(() => {});
    }
  };
}
