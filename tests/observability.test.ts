import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import {
  beginRequest,
  createRequestLogger,
  withRequestLogging,
  UUID_PATTERN,
} from "../src/lib/observability.ts";
import { proxy } from "../src/proxy.ts";

test("network boundary generates unique IDs and ignores caller headers", () => {
  const req = new Request("https://example.test/?token=private-marker", {
    headers: { "x-request-id": "11111111-1111-4111-8111-111111111111" },
  });
  const a = beginRequest(req),
    b = beginRequest(req);
  assert.match(a.requestId, UUID_PATTERN);
  assert.notEqual(a.requestId, b.requestId);
  assert.notEqual(a.requestId, req.headers.get("x-request-id"));
  assert.equal(a.route, "/");
  assert.ok(!JSON.stringify(a).includes("private-marker"));
});

test("unknown routes never retain private path segments or queries", () => {
  const ctx = beginRequest(new Request("https://example.test/private-marker?email=private-marker"));
  assert.equal(ctx.route, "unmatched");
  assert.ok(!JSON.stringify(ctx).includes("private-marker"));
});

test("logger emits parseable JSON using only safe metadata", () => {
  const lines: string[] = [];
  const log = createRequestLogger((line) => lines.push(line));
  const context = beginRequest(new Request("https://example.test/api/health"));
  log("request.completed", { ...context, status: 200, durationMs: 1.23456 });
  const record = JSON.parse(lines[0]!);
  assert.deepEqual(
    Object.keys(record).sort(),
    ["timestamp", "level", "event", "requestId", "route", "method", "status", "durationMs"].sort(),
  );
  assert.equal(record.durationMs, 1.235);
  assert.equal(record.status, 200);
  assert.ok(Number.isFinite(Date.parse(record.timestamp)));
});

test("logger discards extra fields including raw errors and sensitive objects", () => {
  const lines: string[] = [];
  const context = beginRequest(new Request("https://example.test/status"));
  const unsafe = {
    ...context,
    authorization: "private-marker",
    cookie: "private-marker",
    password: "private-marker",
    body: { value: "private-marker" },
    url: "https://private-marker",
    error: new Error("private-marker"),
  };
  createRequestLogger((line) => lines.push(line))("request.failed", unsafe);
  assert.ok(!lines[0]!.includes("private-marker"));
  assert.equal(JSON.parse(lines[0]!).errorType, "unhandled");
});

test("logger rejects untrusted values even in allowed fields", () => {
  const lines: string[] = [];
  const unsafe = {
    requestId: "private-marker",
    route: "private-marker",
    method: "private-marker",
    status: 999,
    durationMs: Infinity,
  } as unknown as Parameters<ReturnType<typeof createRequestLogger>>[1];
  createRequestLogger((line) => lines.push(line))("request.completed", unsafe);
  const record = JSON.parse(lines[0]!);
  assert.match(record.requestId, UUID_PATTERN);
  assert.equal(record.route, "unmatched");
  assert.equal(record.method, "OTHER");
  assert.equal(record.status, undefined);
  assert.equal(record.durationMs, undefined);
  assert.ok(!lines[0]!.includes("private-marker"));
});

test("proxy forwards its generated ID and exposes only that response header", () => {
  const request = new NextRequest("https://example.test/status?token=private-marker", {
    headers: { "x-request-id": "private-marker", authorization: "private-marker" },
  });
  const response = proxy(request);
  const id = response.headers.get("x-request-id");
  assert.match(id!, UUID_PATTERN);
  assert.equal(response.headers.get("x-middleware-request-x-request-id"), id);
  assert.equal(response.headers.get("authorization"), null);
});

test("handler completion keeps body, status, cache and correlated ID", async () => {
  const lines: string[] = [];
  const id = beginRequest(new Request("https://example.test")).requestId;
  const handler = withRequestLogging(
    "/api/health",
    () => Response.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } }),
    createRequestLogger((line) => lines.push(line)),
  );
  const response = await handler(
    new Request("https://example.test/api/health", { headers: { "x-request-id": id } }),
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("x-request-id"), id);
  const record = JSON.parse(lines[0]!);
  assert.equal(record.requestId, id);
  assert.equal(record.event, "request.completed");
  assert.ok(record.durationMs >= 0);
});

test("failed handler logs only a safe category and returns a safe response", async () => {
  const lines: string[] = [];
  const error = new Error("private-marker");
  const handler = withRequestLogging(
    "/api/health",
    () => {
      throw error;
    },
    createRequestLogger((line) => lines.push(line)),
  );
  const response = await handler(new Request("https://example.test/api/health"));
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes("private-marker"));
  assert.equal(JSON.parse(lines[0]!).event, "request.failed");
  assert.ok(!lines[0]!.includes("private-marker"));
  assert.equal(JSON.parse(lines[0]!).status, 500);
});

test("concurrent requests do not share correlation state", async () => {
  const lines: string[] = [];
  const handler = withRequestLogging(
    "/api/health",
    async () => {
      await Promise.resolve();
      return Response.json({ ok: true });
    },
    createRequestLogger((line) => lines.push(line)),
  );
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => handler(new Request("https://example.test/api/health"))),
  );
  const ids = responses.map((response) => response.headers.get("x-request-id"));
  assert.equal(new Set(ids).size, 12);
  assert.deepEqual(new Set(lines.map((line) => JSON.parse(line).requestId)), new Set(ids));
});

test("sink failure does not break the response", async () => {
  const handler = withRequestLogging(
    "/api/health",
    () => Response.json({ ok: true }),
    createRequestLogger(() => {
      throw new Error("private-marker");
    }),
  );
  assert.equal((await handler(new Request("https://example.test/api/health"))).status, 200);
});
