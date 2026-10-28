import assert from "node:assert/strict";
const ids = new Set();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function checkId(response) {
  const id = response.headers.get("x-request-id");
  assert.match(id || "", uuid);
  assert.ok(!ids.has(id), "Request ID must be unique");
  ids.add(id);
}
const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
for (const [path, expectedStatus, text] of [
  ["/", 200, "Sua próxima farm"],
  ["/status", 200, "AINDA NÃO DISPONÍVEL"],
  ["/rota-inexistente-redpro", 404, "Este bloco"],
]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expectedStatus, path);
  checkId(response);
  assert.ok((await response.text()).includes(text), "Conteúdo ausente em " + path);
  console.log("PASS " + path + " — HTTP " + expectedStatus);
}
const response = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
checkId(response);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), {
  status: "ok",
  service: "redpro",
  version: "0.1.0",
  scope: "application-only",
});
console.log("PASS /api/health — processo responde; sem alegar conexão externa");
