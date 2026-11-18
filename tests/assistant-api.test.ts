import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/assistant/route.ts";
import { handleAssistant, MAX_BODY_BYTES } from "../src/features/assistant/http.ts";
import { createRequestLogger, withRequestLogging } from "../src/lib/observability.ts";
import { isAssistantReply } from "../src/features/assistant/contracts.ts";

const context = { edition: "JAVA", game_version: "1.21.1", mode: "BUILDER" } as const;
const content = { message: "Planeje uma base 21 × 21", context };
const url = "http://127.0.0.1:3000/api/assistant";

function request(
  body: string,
  contentType = "application/json; charset=utf-8",
  extra?: HeadersInit,
) {
  return new Request(url, {
    method: "POST",
    body,
    headers: { "content-type": contentType, ...extra },
  });
}

async function expectError(res: Response, status: number, code: string) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const error = await res.json();
  assert.equal(error.type, "ERROR");
  assert.equal(error.code, code);
  assert.equal(typeof error.text, "string");
  return error;
}

test("POST responds with the validated context, typed guidance and no external fetch", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("unexpected external request");
  });
  const response = await POST(request(JSON.stringify(content)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  const result: unknown = await response.json();
  assert.ok(isAssistantReply(result));
  assert.equal(result.type, "ANSWER");
  assert.equal(result.procedureId, "builder-base-21");
  assert.deepEqual(result.context, context);
  assert.equal(result.answer.materials?.[0].quantity, 441);
  assert.equal(fetch.mock.callCount(), 0);
});

test("POST distinguishes a clarification or unsupported topic from a technical failure", async () => {
  for (const body of [
    { ...content, context: { ...context, game_version: null } },
    { ...content, message: "Dê uma seed com coordenadas exatas" },
  ]) {
    const response = await POST(request(JSON.stringify(body)));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result: unknown = await response.json();
    assert.ok(isAssistantReply(result));
    assert.equal(result.type, body.context.game_version === null ? "CLARIFICATION" : "UNSUPPORTED");
  }
});

test("POST rejects media type, invalid JSON, and unexpected context and fields", async () => {
  await expectError(
    await POST(request(JSON.stringify(content), "text/plain")),
    415,
    "UNSUPPORTED_MEDIA_TYPE",
  );
  await expectError(await POST(request("{")), 400, "INVALID_JSON");
  for (const body of [
    null,
    ["unexpected"],
    { ...content, context: { ...context, edition: "NINTENDO" } },
    { ...content, context: { ...context, mode: "ASSIST" } },
    { ...content, context: { ...context, game_version: "1.21.1\n" } },
    { ...content, message: "x".repeat(4001) },
    { ...content, token: "fixture" },
  ]) {
    await expectError(await POST(request(JSON.stringify(body))), 400, "INVALID_INPUT");
  }
});

test("POST caps total bytes with or without Content-Length and cancels an oversized body", async () => {
  await expectError(
    await POST(
      request(JSON.stringify(content), "application/json", {
        "content-length": String(MAX_BODY_BYTES + 1),
      }),
    ),
    413,
    "PAYLOAD_TOO_LARGE",
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_BODY_BYTES).fill(32));
      controller.enqueue(new Uint8Array([32]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  };
  await expectError(await POST(new Request(url, init)), 413, "PAYLOAD_TOO_LARGE");
  assert.equal(cancelled, true);
});

test("POST handles invalid engine output and exceptions without logging questions or error details", async () => {
  const records: string[] = [];
  const privateInput = "entrada-sintetica-que-nao-pode-aparecer";
  const privateError = "detalhe-sintetico-da-excecao";
  const body = JSON.stringify({ message: privateInput, context });
  const handler = withRequestLogging(
    "/api/assistant",
    (req) =>
      handleAssistant(req, () => {
        throw new Error(privateError);
      }),
    createRequestLogger((line) => records.push(line)),
  );
  const payload = await expectError(await handler(request(body)), 500, "INTERNAL_ERROR");
  assert.doesNotMatch(
    JSON.stringify(payload) + records.join("\n"),
    /entrada-sintetica|detalhe-sintetico/,
  );
  assert.equal(JSON.parse(records[0]).route, "/api/assistant");
  assert.equal(JSON.parse(records[0]).status, 500);

  const wrongContext = await handleAssistant(request(body), () => ({
    type: "UNSUPPORTED",
    context: { ...context, mode: "COMMAND" },
    text: "contexto do turno errado",
  }));
  await expectError(wrongContext, 500, "INTERNAL_ERROR");
});

test("C-DEF-001: POST clarifies mismatched editions and versions without issuing a procedure", async () => {
  for (const [message, { edition, game_version }] of [
    ["Quero montar uma farm de ferro para Minecraft Bedrock 1.21.0.", context],
    ["Meu pistão comum não estende em Java 1.20.1. Como testo?", context],
    [
      "Meu pistão comum não estende no Minecraft Java 1.21.1. Como testo?",
      { edition: "BEDROCK", game_version: "1.21.0" },
    ],
  ] as const) {
    const expectedContext = { ...context, edition, game_version };
    const response = await POST(request(JSON.stringify({ message, context: expectedContext })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result: unknown = await response.json();
    assert.ok(isAssistantReply(result));
    assert.equal(result.type, "CLARIFICATION", message);
    assert.deepEqual(result.context, expectedContext);
    assert.equal(result.followUp, undefined);
    assert.equal("answer" in result, false);
  }
});
