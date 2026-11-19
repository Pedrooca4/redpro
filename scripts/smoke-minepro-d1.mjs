import assert from "node:assert/strict";

const mode = process.argv[2];
const base = URL.parse(process.argv[3] ?? "http://127.0.0.1:3000");
assert.ok(mode === "enabled" || mode === "disabled", "Choose enabled or disabled");
assert.ok(
  base?.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) &&
    !base.username &&
    !base.password,
  "Use an HTTP loopback URL",
);
const url = new URL("/api/assistant/conversation", base);
const spoofedRequestId = "a61beb75-5d96-4a31-a0cb-01ad75a87ff9";
const context = { edition: "JAVA", game_version: "1.21.1", mode: "BUILDER" };
const body = {
  turnId: "local-builder",
  idempotencyKey: "local-builder",
  context,
  message: "Quantos blocos preciso para construir o piso da base 21 × 21?",
};
let cookie;
const checks = [];

async function send(label, input, expected, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": spoofedRequestId,
      ...(cookie && { cookie }),
      ...extraHeaders,
    },
    body: typeof input === "string" ? input : JSON.stringify(input),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json();
  assert.equal(response.status, expected.status ?? 200);
  assert.equal(value.type, expected.type);
  assert.equal(value.reason, expected.reason);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(value.requestId, response.headers.get("x-request-id"));
  assert.notEqual(value.requestId, spoofedRequestId);
  checks.push({ label, status: response.status, type: value.type, reason: value.reason });
  return { value, cookieHeader: response.headers.get("set-cookie") };
}

const setup = await send("gate", body, {
  type: "UNAVAILABLE",
  reason: mode === "enabled" ? "SESSION_REQUIRED" : "FEATURE_DISABLED",
});
if (mode === "enabled") {
  assert.ok(setup.cookieHeader?.includes("HttpOnly; SameSite=Strict;"));
  cookie = setup.cookieHeader.split(";")[0];
  const verified = await send("calculated floor", body, { type: "VERIFIED" });
  assert.equal(verified.value.evidence.kind, "CALCULATED");
  assert.equal(verified.value.evidence.calculations[0].result, 441);
  assert.deepEqual(verified.value.sources, []);
  const replay = await send("idempotent response", body, { type: "VERIFIED" });
  assert.equal(replay.value.evidence.calculations[0].result, 441);
  assert.notEqual(verified.value.requestId, replay.value.requestId);
  await send(
    "model blocked with zero virtual budget",
    {
      ...body,
      turnId: "uncovered",
      idempotencyKey: "uncovered",
      message: "Como planejo a entrada da minha base num terreno inclinado?",
    },
    { type: "UNAVAILABLE", reason: "BUDGET_UNAVAILABLE" },
  );
  await send(
    "edition conflict",
    {
      ...body,
      turnId: "conflict",
      idempotencyKey: "conflict",
      message: "Como planejo os blocos da base 21 × 21 no Minecraft Bedrock 1.21.0?",
    },
    { type: "CLARIFICATION" },
  );
  const remote = await send(
    "cross-origin guard",
    body,
    {
      type: "UNAVAILABLE",
      reason: "FEATURE_DISABLED",
    },
    { origin: "http://example.invalid" },
  );
  assert.equal(remote.cookieHeader, null);
} else {
  assert.equal(setup.cookieHeader, null);
}
const invalid = await send("minimal invalid-input envelope", "{}", { status: 400, type: "ERROR" });
assert.deepEqual(Object.keys(invalid.value).sort(), [
  "contractVersion",
  "error",
  "requestId",
  "type",
]);

console.log(JSON.stringify({ mode, checks }, null, 2));
