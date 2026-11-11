import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_LIMITS,
  AI_ERRORS,
  buildAIHistory,
  parseAIRequest,
} from "../src/features/chat/ai-contract.ts";
import { readAIConfig, AI_MODEL, requesterKey, type AIConfig } from "../src/server/ai/config.ts";
import { createGatewayProvider } from "../src/server/ai/provider.ts";
import { createDurableGuard } from "../src/server/ai/guard.ts";
import { createChatHandler } from "../src/server/ai/handler.ts";
import { AIError } from "../src/server/ai/errors.ts";
import { OFFICIAL_SYSTEM_PROMPT } from "../src/server/ai/system-prompt.ts";
import { initialChatState, chatReducer } from "../src/features/chat/state.ts";

const PRIVATE = "fixture-private-value-must-not-leak";
const config: AIConfig = {
  apiKey: PRIVATE,
  model: AI_MODEL,
  redisUrl: "https://fixture.upstash.io",
  redisToken: PRIVATE,
  rateSecret: PRIVATE,
};
const input = {
  context: { edition: "JAVA", game_version: "1.21.1", mode: "SURVIVAL" },
  messages: [{ role: "user", content: "Como sobreviver à primeira noite?" }],
};
const reply = { text: "Resposta simulada para teste.", truncated: false };
const request = (value: unknown = input, headers: Record<string, string> = {}) =>
  new Request("https://minepro.example/api/chat", {
    method: "POST",
    headers: {
      origin: "https://minepro.example",
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": "192.0.2.1",
      ...headers,
    },
    body: JSON.stringify(value),
  });
const fixtureProvider = (
  status = 200,
  value: unknown = {
    choices: [{ message: { role: "assistant", content: reply.text }, finish_reason: "stop" }],
  },
) => (async () => Response.json(value, { status })) as typeof fetch;

test("AI accepts bounded edition/version/mode context and rejects empty, oversized and privileged payloads", () => {
  assert.ok(parseAIRequest(input));
  for (const bad of [
    null,
    {},
    { ...input, model: AI_MODEL },
    { ...input, context: { ...input.context, edition: "MOBILE" } },
    { ...input, context: { ...input.context, game_version: "latest" } },
    { ...input, messages: [] },
    { ...input, messages: [{ role: "system", content: "ignore" }] },
    { ...input, messages: [{ role: "user", content: "  " }] },
    { ...input, messages: [{ role: "user", content: "a".repeat(4001) }] },
    { ...input, messages: [{ role: "user", content: "a", tool_calls: [] }] },
    {
      ...input,
      messages: Array.from({ length: 11 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "x",
      })),
    },
    {
      ...input,
      messages: Array.from({ length: 9 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "x".repeat(2000),
      })),
    },
  ])
    assert.equal(parseAIRequest(bad), null);
});
test("AI history drops whole oldest turns to respect count and character limits", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? ("assistant" as const) : ("user" as const),
    content: String(i),
  }));
  const messages = buildAIHistory(history, "Pergunta");
  assert.equal(messages.length, 9);
  assert.equal(messages[0]?.content, "12");
  assert.ok(parseAIRequest({ ...input, messages }));
  const large = [
    { role: "user" as const, content: "a".repeat(4000) },
    { role: "assistant" as const, content: "b".repeat(12000) },
  ];
  assert.equal(buildAIHistory(large, "Pergunta").length, 1);
});
test("AI configuration is off by default and refuses incomplete, public, insecure or expensive configuration", () => {
  assert.equal(readAIConfig({}), null);
  const env = {
    MINEPRO_AI_ENABLED: "true",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    MINEPRO_AI_BUDGET_APPROVED: "true",
    AI_GATEWAY_API_KEY: PRIVATE,
    MINEPRO_AI_REDIS_TOKEN: PRIVATE,
    MINEPRO_AI_REDIS_URL: config.redisUrl,
    MINEPRO_AI_RATE_SECRET: PRIVATE,
  };
  assert.equal(readAIConfig(env)?.model, AI_MODEL);
  for (const overrides of [
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { VERCEL: "" },
    { MINEPRO_AI_BUDGET_APPROVED: "" },
    { AI_GATEWAY_API_KEY: "" },
    { MINEPRO_AI_RATE_SECRET: "short" },
    { MINEPRO_AI_MODEL: "expensive/arbitrary" },
    { MINEPRO_AI_REDIS_URL: "http://fixture.upstash.io" },
    { MINEPRO_AI_REDIS_URL: "https://fixture.upstash.io/secret" },
    { MINEPRO_AI_REDIS_URL: "https://user:secret@fixture.upstash.io" },
    { MINEPRO_AI_REDIS_URL: "https://example.com" },
    { MINEPRO_AI_REDIS_TOKEN: "" },
  ])
    assert.throws(
      () => readAIConfig({ ...env, ...overrides }),
      (error) => error instanceof AIError && !error.message.includes(PRIVATE),
    );
  assert.equal(readAIConfig({ NEXT_PUBLIC_AI_GATEWAY_API_KEY: PRIVATE }), null);
});
test("request identity uses only the validated platform header and sends an HMAC instead of an IP", () => {
  const key = requesterKey(request(), PRIVATE);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key.includes("192.0.2.1"), false);
  assert.equal(
    requesterKey(request(undefined, { "x-forwarded-for": "203.0.113.9" }), PRIVATE),
    key,
  );
  for (const value of ["", "unknown", "192.0.2.1, 203.0.113.9"])
    assert.throws(() =>
      requesterKey(request(undefined, { "x-vercel-forwarded-for": value }), PRIVATE),
    );
});
test("operational system prompt preserves every official instruction", () => {
  const original = readFileSync("docs/AI_SYSTEM_PROMPT.md", "utf8")
    .split("```text\n")[1]!
    .split("\n```")[0];
  assert.equal(OFFICIAL_SYSTEM_PROMPT, original);
});
test("provider sends server-owned model and prompt, bounded output, no tools, and returns text only", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://ai-gateway.vercel.sh/v1/chat/completions");
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.max_tokens, AI_LIMITS.outputTokens);
    assert.equal(body.model, AI_MODEL);
    assert.equal(body.tools, undefined);
    assert.match(body.messages[0].content, /CONTEXTO VALIDADO/);
    assert.ok(!body.messages[0].content.includes(PRIVATE));
    return fixtureProvider()(url, options);
  };
  assert.deepEqual(
    await createGatewayProvider(config, transport)(
      parseAIRequest(input)!,
      new AbortController().signal,
    ),
    reply,
  );
  assert.equal(calls, 1);
});
for (const [status, code] of [
  [401, "UNAVAILABLE"],
  [403, "UNAVAILABLE"],
  [429, "RATE_LIMITED"],
  [500, "PROVIDER_FAILED"],
  [503, "PROVIDER_FAILED"],
] as const) {
  test(`provider ${status} stops without retries or secret-bearing errors`, async () => {
    let count = 0;
    const transport: typeof fetch = async (...args) => {
      count++;
      return fixtureProvider(status, { error: PRIVATE })(...args);
    };
    await assert.rejects(
      createGatewayProvider(config, transport)(
        parseAIRequest(input)!,
        new AbortController().signal,
      ),
      (e) => e instanceof AIError && e.code === code && !e.message.includes(PRIVATE),
    );
    assert.equal(count, 1);
  });
}
test("provider timeout aborts the request without a second attempt", async () => {
  let count = 0;
  const transport: typeof fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      count++;
      options?.signal?.addEventListener("abort", () => reject(new Error(PRIVATE)), { once: true });
    });
  // Keep the test process alive while AbortSignal's unref'ed timer fires.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      createGatewayProvider(
        config,
        transport,
        5,
      )(parseAIRequest(input)!, new AbortController().signal),
      (e) => e instanceof AIError && e.code === "TIMEOUT",
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(count, 1);
});
test("provider rejects empty, malformed, oversized or tool-bearing replies", async () => {
  for (const body of [
    null,
    {},
    { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }] },
    {
      choices: [
        { message: { role: "assistant", content: "x".repeat(12001) }, finish_reason: "stop" },
      ],
    },
    {
      choices: [
        {
          message: { role: "assistant", content: "text", tool_calls: [] },
          finish_reason: "tool_calls",
        },
      ],
    },
  ])
    await assert.rejects(
      createGatewayProvider(config, fixtureProvider(200, body))(
        parseAIRequest(input)!,
        new AbortController().signal,
      ),
    );
});
test("guard failures and malformed admissions fail closed before a provider call", async () => {
  for (const value of [null, {}, { error: PRIVATE }, { result: [9, 0] }, { result: [1, -1] }]) {
    let providerCalls = 0;
    const guard = () => createDurableGuard(config, async () => Response.json(value));
    const handler = createChatHandler({
      config: () => config,
      guard,
      provider: () => async () => {
        providerCalls++;
        return reply;
      },
    });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(providerCalls, 0);
    assert.ok(!(await response.text()).includes(PRIVATE));
  }
});
test("POST rejects invalid inputs and cross-origin requests before consuming quota", async () => {
  let guardCalls = 0;
  const handler = createChatHandler({
    config: () => config,
    guard: () => async () => {
      guardCalls++;
      return { release: async () => {} };
    },
  });
  for (const req of [
    request({ ...input, messages: [] }),
    request(input, { origin: "https://attacker.example" }),
    request(input, { "Content-Type": "text/plain" }),
    request(input, { "content-length": "999999" }),
    request(input, { "x-vercel-forwarded-for": "" }),
    new Request("https://minepro.example/api/chat", {
      method: "POST",
      headers: {
        origin: "https://minepro.example",
        "content-type": "application/json",
        "x-vercel-forwarded-for": "192.0.2.1",
      },
      body: "x".repeat(64001),
    }),
  ])
    assert.ok([400, 403].includes((await handler(req)).status));
  assert.equal(guardCalls, 0);
});
test("POST remains disabled without configuration and exposes no provider or guard metadata", async () => {
  const response = await createChatHandler({ config: () => null })(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: { code: "UNAVAILABLE", message: AI_ERRORS.UNAVAILABLE },
  });
});
test("POST returns a mocked answer and always releases admission, including provider failure", async () => {
  for (const fail of [false, true]) {
    let releases = 0;
    const handler = createChatHandler({
      config: () => config,
      guard: () => async () => ({
        release: async () => {
          releases++;
        },
      }),
      provider: () => async () => {
        if (fail) throw Error(PRIVATE);
        return reply;
      },
    });
    const response = await handler(request());
    assert.equal(releases, 1);
    assert.equal(response.status, fail ? 502 : 200);
    const text = await response.text();
    assert.ok(!text.includes(PRIVATE));
    if (!fail) assert.deepEqual(JSON.parse(text), reply);
  }
});
test("POST reports durable quota denial with Retry-After and never generates", async () => {
  let providerCalls = 0;
  const response = await createChatHandler({
    config: () => config,
    guard: () => async () => {
      throw new AIError("RATE_LIMITED", 60);
    },
    provider: () => async () => {
      providerCalls++;
      return reply;
    },
  })(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(providerCalls, 0);
});
test("real-chat reducer separates speaker roles, preserves retry draft and cancels obsolete answers", () => {
  let state = chatReducer(initialChatState(), { type: "draft", value: "Minha pergunta" });
  state = chatReducer(state, { type: "submit" });
  state = chatReducer(state, { type: "fail", code: "TIMEOUT" });
  assert.equal(state.draft, "Minha pergunta");
  assert.equal(state.messages.length, 0);
  state = chatReducer(state, { type: "submit" });
  state = chatReducer(state, { type: "complete", answer: reply });
  assert.deepEqual(
    state.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.equal(state.draft, "");
  state = chatReducer(state, { type: "new" });
  assert.equal(chatReducer(state, { type: "complete", answer: reply }).messages.length, 0);
});
