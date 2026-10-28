import assert from "node:assert/strict";
const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
for (const [path, expectedStatus, text] of [
  ["/", 200, "Sua próxima farm"],
  ["/status", 200, "AINDA NÃO DISPONÍVEL"],
  ["/rota-inexistente-redpro", 404, "Este bloco"],
]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expectedStatus, path);
  assert.ok((await response.text()).includes(text), "Conteúdo ausente em " + path);
  console.log("PASS " + path + " — HTTP " + expectedStatus);
}
const response = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), {
  status: "ok",
  service: "redpro",
  version: "0.1.0",
  scope: "application-only",
});
console.log("PASS /api/health — processo responde; sem alegar conexão externa");
