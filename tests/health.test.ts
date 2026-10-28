import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/health/route.ts";
test("health responde sem env, sem credenciais e sem afirmar integracoes externas", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "redpro",
    version: "0.1.0",
    scope: "application-only",
  });
});
