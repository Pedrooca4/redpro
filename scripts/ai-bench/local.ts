import { Agent, request } from "node:http";
import { performance } from "node:perf_hooks";

export const LOCAL_HOST = "127.0.0.1";
export const LOCAL_PORT = 18123;
export const MODEL_ALIAS = "minepro-bench";
export const CONTEXT_TOKENS = 4096;
export const MAX_OUTPUT_TOKENS = 256;
export const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const agent = new Agent({ keepAlive: false });

export type ChatMessage = { role: "system" | "user"; content: string };
export type Completion = {
  text: string;
  latencyMs: number;
  outputTokens: number | null;
  inputTokens: number | null;
  tokensPerSecond: number | null;
  truncated: boolean;
};

export class BenchError extends Error {}

export function localRequest(
  path: "/v1/models" | "/v1/chat/completions",
  apiKey: string,
  body?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  if (path !== "/v1/models" && path !== "/v1/chat/completions") {
    return Promise.reject(new BenchError("Rota fora do contrato local."));
  }
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const req = request(
      {
        hostname: LOCAL_HOST,
        port: LOCAL_PORT,
        path,
        method: body === undefined ? "GET" : "POST",
        agent,
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new BenchError(`llama.cpp retornou HTTP ${response.statusCode}.`));
          response.destroy();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("error", () => reject(new BenchError("Resposta local interrompida.")));
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            reject(new BenchError("Resposta local excede o limite de bytes."));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new BenchError("Resposta local não contém JSON válido."));
          }
        });
      },
    );
    req.on("error", () =>
      reject(
        new BenchError(
          signal.aborted ? "Tempo de inferência esgotado." : "Servidor local indisponível.",
        ),
      ),
    );
    req.end(body);
  });
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseCompletion(data: unknown, latencyMs: number): Completion {
  const response = asObject(data);
  const choice = asObject(Array.isArray(response.choices) ? response.choices[0] : undefined);
  const message = asObject(choice.message);
  const usage = asObject(response.usage);
  const tokensPerSecond = asObject(response.timings).predicted_per_second;
  const text = typeof message.content === "string" ? message.content.trim() : "";
  if (
    response.model !== MODEL_ALIAS ||
    message.role !== "assistant" ||
    (choice.finish_reason !== "stop" && choice.finish_reason !== "length") ||
    !text ||
    text.length > 12_000 ||
    message.tool_calls !== undefined ||
    (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) ||
    /<\/?think>/i.test(text)
  ) {
    throw new BenchError("Resposta local incompatível com a avaliação textual.");
  }
  return {
    text,
    latencyMs: Math.round(latencyMs),
    outputTokens: validTokenCount(usage.completion_tokens),
    inputTokens: validTokenCount(usage.prompt_tokens),
    tokensPerSecond:
      typeof tokensPerSecond === "number" && Number.isFinite(tokensPerSecond) && tokensPerSecond > 0
        ? tokensPerSecond
        : null,
    truncated: choice.finish_reason === "length",
  };
}

export function createLocalAdapter(
  apiKey: string,
  transport = localRequest,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 512) {
    throw new BenchError("Limite de saída deve ser um inteiro entre 64 e 512 tokens.");
  }
  return async (messages: ChatMessage[]): Promise<Completion> => {
    const start = performance.now();
    const data = await transport(
      "/v1/chat/completions",
      apiKey,
      JSON.stringify({
        model: MODEL_ALIAS,
        messages,
        stream: false,
        max_tokens: maxOutputTokens,
        temperature: 0,
        seed: 42,
        cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
    );
    return parseCompletion(data, performance.now() - start);
  };
}
