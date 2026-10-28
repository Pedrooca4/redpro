import test from "node:test";
import assert from "node:assert/strict";
import { redirect, notFound } from "next/navigation.js";
import {
  withRequestLogging,
  createRequestLogger,
  beginRequest,
  UUID_PATTERN,
} from "../src/lib/observability.ts";
import { createErrorReporter } from "../src/lib/report-error.ts";

for (const thrown of [
  new Error("synthetic-private-marker"),
  "synthetic-private-marker",
  { password: "synthetic-private-marker" },
  null,
]) {
  test(
    "unexpected API values produce safe correlated 500 responses: " + typeof thrown,
    async () => {
      const lines: string[] = [];
      const id = beginRequest(new Request("https://example.test")).requestId;
      const handler = withRequestLogging(
        "/api/health",
        () => {
          throw thrown;
        },
        createRequestLogger((line) => lines.push(line)),
      );
      const response = await handler(
        new Request("https://example.test/api/health?token=synthetic-private-marker", {
          headers: { "x-request-id": id, authorization: "synthetic-private-marker" },
        }),
      );
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-request-id"), id);
      const body = await response.json();
      assert.deepEqual(Object.keys(body.error).sort(), ["code", "message", "requestId"]);
      assert.equal(body.error.requestId, id);
      assert.equal(body.error.code, "INTERNAL_ERROR");
      assert.ok(!JSON.stringify({ body, lines }).includes("synthetic-private-marker"));
      const log = JSON.parse(lines[0]!);
      assert.equal(log.status, 500);
      assert.equal(log.event, "request.failed");
      assert.equal(log.requestId, id);
    },
  );
}

test("failed API without forwarded ID generates a safe ID", async () => {
  const handler = withRequestLogging(
    "/api/health",
    () => {
      throw Error("private");
    },
    createRequestLogger(() => {}),
  );
  const r = await handler(
    new Request("https://example.test/api/health", { headers: { "x-request-id": "private" } }),
  );
  assert.match(r.headers.get("x-request-id")!, UUID_PATTERN);
  assert.equal((await r.json()).error.requestId, r.headers.get("x-request-id"));
});

test("returned 404 and redirects remain ordinary responses", async () => {
  for (const response of [
    Response.json({ code: "NOT_FOUND" }, { status: 404 }),
    Response.redirect("https://example.test/status", 307),
  ]) {
    const handler = withRequestLogging(
      "/api/health",
      () => response,
      createRequestLogger(() => {}),
    );
    const result = await handler(new Request("https://example.test/api/health"));
    assert.equal(result.status, response.status);
    assert.equal(result.headers.get("location"), response.headers.get("location"));
  }
});

test("Next redirect and notFound control flow is preserved", async () => {
  for (const action of [() => redirect("/status"), () => notFound()]) {
    const handler = withRequestLogging(
      "/api/health",
      action,
      createRequestLogger(() => {}),
    );
    await assert.rejects(
      handler(new Request("https://example.test/api/health")),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "digest" in error);
        return /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/.test(String(error.digest));
      },
    );
  }
});

test("instrumentation preserves ID and drops private error/request content", async () => {
  const lines: string[] = [];
  const id = beginRequest(new Request("https://example.test")).requestId;
  const report = createErrorReporter(createRequestLogger((line) => lines.push(line)));
  await report(
    new Error("synthetic-private-marker"),
    {
      path: "/private/synthetic-private-marker?token=secret",
      method: "GET",
      headers: { "x-request-id": id, authorization: "synthetic-private-marker" },
    },
    {
      routerKind: "App Router",
      routePath: "/private",
      routeType: "render",
      renderSource: "react-server-components",
      revalidateReason: undefined,
    },
  );
  const record = JSON.parse(lines[0]!);
  assert.equal(record.requestId, id);
  assert.equal(record.route, "unmatched");
  assert.ok(!JSON.stringify(lines).includes("synthetic-private-marker"));
});
