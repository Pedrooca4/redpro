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
  ["/", 200, "Seis modos. Seu mundo inteiro."],
  ["/status", 200, "AINDA NÃO DISPONÍVEL"],
  ["/chat", 200, "Assistente MinePRO"],
  ["/ferramentas/materiais", 200, "Calculadora de materiais"],
  ["/projetos", 200, "ainda não há projetos publicados"],
  ["/comunidade", 200, "ainda não há publicações"],
  ["/rota-inexistente-minepro", 404, "Este bloco"],
]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expectedStatus, path);
  checkId(response);
  const html = await response.text();
  assert.ok(html.includes(text), "Conteúdo ausente em " + path);
  assert.ok(!/redpro/i.test(html), "Identidade anterior no HTML público: " + path);
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

const assistant = await fetch(new URL("/api/assistant", base), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Planeje uma base 21 × 21",
    context: { edition: "JAVA", game_version: "1.21.1", mode: "BUILDER" },
  }),
  signal: AbortSignal.timeout(15000),
});
assert.equal(assistant.status, 200);
checkId(assistant);
assert.equal(assistant.headers.get("cache-control"), "private, no-store");
const reply = await assistant.json();
assert.equal(reply.type, "ANSWER");
assert.equal(reply.procedureId, "builder-base-21");
assert.deepEqual(reply.context, { edition: "JAVA", game_version: "1.21.1", mode: "BUILDER" });
assert.equal(reply.answer.materials[0].quantity, 441);
console.log("PASS POST /api/assistant — resposta guiada e contexto verificados");
