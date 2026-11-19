import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/assistant/conversation/route.ts";
import {
  CONVERSATION_PATH,
  type ConversationResponse,
} from "../src/features/assistant/conversation/contracts.ts";
import { createConversationHandler } from "../src/features/assistant/conversation/http.ts";
import {
  createSimulationStore,
  MAX_SIMULATION_TURNS,
} from "../src/features/assistant/conversation/ledger.ts";
import {
  createMockProvider,
  type MockScenario,
} from "../src/features/assistant/conversation/provider.ts";
import { createConversationService } from "../src/features/assistant/conversation/service.ts";
import { MAX_BODY_BYTES } from "../src/features/assistant/http.ts";

const url = `http://127.0.0.1:3000${CONVERSATION_PATH}`;
const localEnvironment = { NODE_ENV: "test", MINEPRO_D1_MOCK: "1" };
const input = {
  turnId: "one",
  idempotencyKey: "key-one",
  message: "Como organizo uma bancada de redstone?",
  context: { edition: "JAVA", game_version: "1.21.1", mode: "RED" },
};

function request(body: BodyInit = JSON.stringify(input), headers: HeadersInit = {}, address = url) {
  return new Request(address, {
    method: "POST",
    body,
    headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers },
  });
}

async function verify(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const value = (await response.json()) as ConversationResponse;
  assert.equal(value.contractVersion, "1.0");
  assert.match(value.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get("x-request-id"), value.requestId);
  return value;
}

async function beginSession(handle: ReturnType<typeof createConversationHandler>) {
  const response = await handle(request());
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.ok(cookie.includes("HttpOnly; SameSite=Strict;"));
  assert.ok(cookie.endsWith(`Path=${CONVERSATION_PATH}`));
  const body = await verify(response, 200);
  assert.equal(body.type === "UNAVAILABLE" && body.reason, "SESSION_REQUIRED");
  return cookie.split(";")[0];
}

test("default App Router handler validates input and is disabled unless explicitly enabled", async () => {
  const result = await verify(await POST(request()), 200);
  assert.equal(result.type === "UNAVAILABLE" && result.reason, "FEATURE_DISABLED");
  assert.equal(result.turnId, input.turnId);
});

test("preview, production, no opt-in and non-loopback requests never initialize storage or the fixture", async () => {
  const denied = [
    [{ ...localEnvironment, NODE_ENV: "production" }, request()],
    [{ ...localEnvironment, VERCEL_ENV: "preview" }, request()],
    [{ ...localEnvironment, VERCEL_TARGET_ENV: "staging" }, request()],
    [{ ...localEnvironment, VERCEL: "1" }, request()],
    [{ ...localEnvironment, VERCEL_URL: "example.invalid" }, request()],
    [{ NODE_ENV: "development" }, request()],
    [localEnvironment, request(JSON.stringify(input), { host: "example.invalid:3000" })],
    [
      localEnvironment,
      request(JSON.stringify(input), {}, `http://example.invalid:3000${CONVERSATION_PATH}`),
    ],
    [localEnvironment, request(JSON.stringify(input), { origin: "http://example.invalid:3000" })],
    [localEnvironment, request(JSON.stringify(input), { "sec-fetch-site": "cross-site" })],
    [localEnvironment, request(JSON.stringify(input), { "x-forwarded-for": "192.0.2.1" })],
    [localEnvironment, request(JSON.stringify(input), { "x-forwarded-host": "example.invalid" })],
    [localEnvironment, request(JSON.stringify(input), { forwarded: "for=192.0.2.1" })],
    [localEnvironment, request(JSON.stringify(input), { "x-real-ip": "192.0.2.1" })],
  ] as const;
  let initialized = 0;
  for (const [env, req] of denied) {
    const handle = createConversationHandler({
      environment: () => env,
      createService() {
        initialized++;
        throw new Error("Should not initialize external request");
      },
    });
    const response = await handle(req);
    assert.equal(response.headers.get("set-cookie"), null);
    const result = await verify(response, 200);
    assert.equal(result.type === "UNAVAILABLE" && result.reason, "FEATURE_DISABLED");
  }
  assert.equal(initialized, 0);
});

test("invalid HTTP bodies return the minimal error envelope without echoing unvalidated IDs or context", async () => {
  const handle = createConversationHandler({ environment: () => localEnvironment });
  const malformed = [
    [request("{}", { "content-type": "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    [request('{"broken":'), 400, "INVALID_JSON"],
    [request(new Uint8Array([0xff, 0xfe])), 400, "INVALID_JSON"],
    [request("{}", { "content-length": String(MAX_BODY_BYTES + 1) }), 413, "PAYLOAD_TOO_LARGE"],
    [request("x".repeat(MAX_BODY_BYTES + 1)), 413, "PAYLOAD_TOO_LARGE"],
    [request(JSON.stringify({ ...input, message: "x".repeat(4001) })), 400, "INVALID_INPUT"],
    [request(JSON.stringify({ ...input, turnId: "bad turn" })), 400, "INVALID_INPUT"],
    [
      request(JSON.stringify({ ...input, context: { ...input.context, edition: "invalid" } })),
      400,
      "INVALID_INPUT",
    ],
    [
      request(JSON.stringify({ ...input, context: { ...input.context, game_version: "invalid" } })),
      400,
      "INVALID_INPUT",
    ],
    [
      request(JSON.stringify({ ...input, context: { ...input.context, mode: "invalid" } })),
      400,
      "INVALID_INPUT",
    ],
    [request(JSON.stringify({ ...input, history: ["two", "two"] })), 400, "INVALID_INPUT"],
    [request(JSON.stringify({ ...input, history: [input.turnId] })), 400, "INVALID_INPUT"],
    [
      request(
        JSON.stringify({
          ...input,
          history: Array.from({ length: 7 }, (_, index) => `past-${index}`),
        }),
      ),
      400,
      "INVALID_INPUT",
    ],
    [
      request(JSON.stringify({ ...input, history: [{ origin: "DETERMINISTIC" }] })),
      400,
      "INVALID_INPUT",
    ],
    [request(JSON.stringify({ ...input, model: "external" })), 400, "INVALID_INPUT"],
    [
      request(JSON.stringify({ ...input, followUp: { procedureId: "survival-mining" } })),
      400,
      "INVALID_INPUT",
    ],
  ] as const;
  for (const [req, status, code] of malformed) {
    const result = await verify(await handle(req), status);
    assert.equal(result.type === "ERROR" && result.error.code, code);
    assert.deepEqual(Object.keys(result).sort(), ["contractVersion", "error", "requestId", "type"]);
  }
  const spoof = "192fd5d9-18d1-44cf-8d90-c6efc5575276";
  const result = await verify(await handle(request("{}", { "x-request-id": spoof })), 400);
  assert.notEqual(result.requestId, spoof);
});

test("actual HTTP contract permits the fake only through a scoped session and injected virtual budget", async () => {
  const store = createSimulationStore(30_000);
  const handle = createConversationHandler({
    environment: () => localEnvironment,
    createService: () => createConversationService({ store, provider: createMockProvider() }),
  });
  const cookie = await beginSession(handle);
  assert.equal(store.snapshot().turns.length, 0);
  const first = await verify(await handle(request(JSON.stringify(input), { cookie })), 200);
  assert.equal(first.type, "HYPOTHESIS");
  assert.deepEqual(first.context, input.context);
  if (first.type !== "HYPOTHESIS") assert.fail();
  assert.equal(first.origin, "MODEL");
  assert.equal(first.simulated, true);
  assert.deepEqual(first.sources, []);
  const replay = await verify(await handle(request(JSON.stringify(input), { cookie })), 200);
  assert.equal(replay.type, "HYPOTHESIS");
  assert.notEqual(replay.requestId, first.requestId);
  const forged = await handle(request(JSON.stringify(input), { cookie: `${cookie}invalid` }));
  const refused = await verify(forged, 200);
  assert.equal(refused.type === "UNAVAILABLE" && refused.reason, "SESSION_REQUIRED");
  const otherCookie = await beginSession(handle);
  const nextInput = { ...input, turnId: "two", idempotencyKey: "two", history: ["one"] };
  const foreign = await verify(
    await handle(request(JSON.stringify(nextInput), { cookie: otherCookie })),
    400,
  );
  assert.equal(foreign.type === "ERROR" && foreign.error.code, "INVALID_HISTORY");
  const same = await verify(await handle(request(JSON.stringify(nextInput), { cookie })), 200);
  assert.equal(same.type, "HYPOTHESIS");
  if (same.type !== "HYPOTHESIS") assert.fail();
  assert.match(same.text, /próximo passo/);
  assert.equal(store.snapshot().turns.length, 2);
});

test("enabled development handler's real default has zero budget while deterministic verification stays available", async () => {
  const handle = createConversationHandler({
    environment: () => ({ NODE_ENV: "development", MINEPRO_D1_MOCK: "1" }),
  });
  const cookie = await beginSession(handle);
  const unavailable = await verify(await handle(request(JSON.stringify(input), { cookie })), 200);
  assert.equal(unavailable.type === "UNAVAILABLE" && unavailable.reason, "BUDGET_UNAVAILABLE");
  const deterministic = {
    ...input,
    turnId: "builder",
    idempotencyKey: "builder",
    message: "Quantos blocos preciso para construir o piso da base 21 × 21?",
  };
  const result = await verify(
    await handle(request(JSON.stringify(deterministic), { cookie })),
    200,
  );
  assert.equal(result.type, "VERIFIED");
  if (result.type !== "VERIFIED" || result.evidence.kind !== "CALCULATED") assert.fail();
  assert.equal(result.evidence.calculations[0].result, 441);
});

for (const [scenario, status, code] of [
  ["timeout", 504, "PROVIDER_TIMEOUT"],
  ["transport-error", 503, "TRANSPORT_ERROR"],
  ["invalid-response", 502, "INVALID_PROVIDER_RESPONSE"],
  ["false-verification", 502, "INVALID_PROVIDER_RESPONSE"],
] as const satisfies readonly [MockScenario, number, string][]) {
  test(`HTTP maps ${scenario} to a controlled ${status} after the input is validated`, async () => {
    const handle = createConversationHandler({
      environment: () => localEnvironment,
      createService: () =>
        createConversationService({
          store: createSimulationStore(30_000),
          provider: createMockProvider(scenario),
          timeoutMs: 2,
        }),
    });
    const cookie = await beginSession(handle);
    const result = await verify(await handle(request(JSON.stringify(input), { cookie })), status);
    assert.equal(result.type === "ERROR" && result.error.code, code);
    assert.deepEqual(result.context, input.context);
    assert.equal(result.turnId, input.turnId);
    assert.ok(!JSON.stringify(result).includes("stack"));
  });
}

test("HTTP returns 429 at the local bounded capacity without a provider call", async () => {
  const store = createSimulationStore();
  await store.transact((state) => {
    state.turns = Array.from({ length: MAX_SIMULATION_TURNS }, (_, index) => ({
      session: "another",
      fingerprint: "hash",
      route: "UNAVAILABLE",
      input: {
        ...input,
        turnId: `past-${index}`,
        context: { edition: "JAVA", mode: "RED", game_version: "1.21.1" },
        history: [],
      },
    }));
  });
  const handle = createConversationHandler({
    environment: () => localEnvironment,
    createService: () => createConversationService({ store }),
  });
  const cookie = await beginSession(handle);
  const result = await verify(await handle(request(JSON.stringify(input), { cookie })), 429);
  assert.equal(result.type === "ERROR" && result.error.code, "RATE_LIMITED");
});
