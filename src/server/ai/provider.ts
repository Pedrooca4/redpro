import { AI_LIMITS, type AIRequest, type AIReply } from "../../features/chat/ai-contract.ts";
import type { AIConfig } from "./config.ts";
import { AIError } from "./errors.ts";
import { readLimitedJSON } from "./http.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

export type Generate = (input: AIRequest, signal: AbortSignal) => Promise<AIReply>;

export function createGatewayProvider(
  config: AIConfig,
  transport: typeof fetch = fetch,
  timeoutMs: number = AI_LIMITS.providerTimeoutMs,
): Generate {
  return async (input, clientSignal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([clientSignal, timeout]);
    try {
      const response = await transport("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        signal,
        redirect: "error",
        cache: "no-store",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          max_tokens: AI_LIMITS.outputTokens,
          temperature: 0.2,
          reasoning: { effort: "low" },
          providerOptions: { gateway: { only: ["vertex"], disallowPromptTraining: true } },
          messages: [
            { role: "system", content: buildSystemPrompt(input.context) },
            ...input.messages,
          ],
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 402) throw new AIError("BUDGET_EXHAUSTED");
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after") ?? "";
          const seconds = /^\d{1,5}$/.test(retryAfter) ? Number(retryAfter) : 0;
          throw new AIError("RATE_LIMITED", seconds > 0 && seconds <= 86400 ? seconds : 60);
        }
        if (response.status === 401 || response.status === 403) throw new AIError("UNAVAILABLE");
        throw new AIError("PROVIDER_FAILED");
      }
      const data = (await readLimitedJSON(response.body, 96000, signal)) as {
        choices?: {
          message?: { content?: unknown; role?: unknown; tool_calls?: unknown };
          finish_reason?: unknown;
        }[];
      };
      const choice = data?.choices?.[0];
      const text = choice?.message?.content;
      if (
        choice?.message?.role !== "assistant" ||
        choice.message.tool_calls ||
        !["stop", "length"].includes(String(choice?.finish_reason)) ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > AI_LIMITS.answerCharacters
      )
        throw new AIError("PROVIDER_FAILED");
      // Return text only. No HTML, tool execution, provider metadata, IDs or raw errors.
      return { text: text.trim(), truncated: choice?.finish_reason === "length" };
    } catch (error) {
      if (timeout.aborted || clientSignal.aborted) throw new AIError("TIMEOUT");
      throw error instanceof AIError && error.code !== "INVALID_INPUT"
        ? error
        : new AIError("PROVIDER_FAILED");
    }
  };
}
