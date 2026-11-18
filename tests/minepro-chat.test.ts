import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES,
  EDITIONS,
  TOOLS,
  isGameVersion,
  suggestionsFor,
} from "../src/features/chat/config.ts";
import {
  chatReducer as reduce,
  initialChatState,
  MESSAGE_LIMIT,
} from "../src/features/chat/state.ts";

test("context starts with explicit unknown version and distinct edition labels", () => {
  assert.deepEqual(initialChatState().context, {
    edition: "JAVA",
    game_version: null,
    mode: "RED",
  });
  assert.equal(EDITIONS.JAVA.label, "JavaMine");
  assert.equal(EDITIONS.BEDROCK.label, "BedMine");
  assert.match(EDITIONS.BEDROCK.description, /console e PCs/);
});
test("all six specialties have edition-aware suggestions without fabricated answers", () => {
  assert.deepEqual(
    MODES.map((m) => m.id),
    ["RED", "FARM", "BUILDER", "COMMAND", "MODS", "SURVIVAL"],
  );
  for (const mode of MODES) {
    const state = reduce(initialChatState(), { type: "mode", value: mode.id });
    const java = suggestionsFor(state.context);
    const bedrock = suggestionsFor({
      ...state.context,
      edition: "BEDROCK",
      game_version: "1.21.0",
    });
    assert.equal(state.context.mode, mode.id);
    assert.match(java[0]!, /JavaMine, versão ainda não informada/);
    assert.match(bedrock[0]!, /BedMine, versão 1.21.0/);
    assert.notDeepEqual(java, bedrock);
  }
});
test("switching edition resets version while preserving draft and prior message context", () => {
  let state = reduce(initialChatState(), { type: "version", value: "1.20.1" });
  state = reduce(state, { type: "draft", value: "Uma pergunta de teste" });
  state = reduce(reduce(state, { type: "submit" }), { type: "complete" });
  state = reduce(state, { type: "draft", value: "Meu rascunho" });
  state = reduce(state, { type: "version", value: "bad" });
  assert.ok(state.versionError);
  state = reduce(state, { type: "edition", value: "BEDROCK" });
  assert.equal(state.draft, "Meu rascunho");
  assert.equal(state.context.game_version, null);
  assert.equal(state.versionError, null);
  assert.equal(state.messages[0]!.context.edition, "JAVA");
  assert.equal(state.messages[0]!.context.game_version, "1.20.1");
  assert.match(state.notice, /perder validade/);
});
test("numeric version validation rejects scripts, snapshots and unbounded text", () => {
  for (const version of ["1.21", "1.21.1", "1.20.80"]) assert.ok(isGameVersion(version));
  for (const version of ["", "<script>", "latest", "1.21-pre1", "1.2.9999", "x".repeat(100)])
    assert.equal(isGameVersion(version), false);
  const state = reduce(initialChatState(), { type: "version", value: "bad" });
  assert.equal(state.context.game_version, null);
  assert.match(state.versionError ?? "", /Informe uma versão numérica/);
  assert.equal(state.composerError, null);
});
test("R1-001: reapplying the same valid version preserves the conversation", () => {
  let state = reduce(initialChatState(), { type: "version", value: "1.21.1" });
  state = reduce(state, { type: "mode", value: "BUILDER" });
  state = reduce(state, { type: "draft", value: "Mensagem anterior" });
  state = reduce(reduce(state, { type: "submit" }), { type: "complete" });
  const previous = reduce(state, { type: "draft", value: "Rascunho mantido" });

  const invalid = reduce(previous, { type: "version", value: "bad" });
  assert.match(invalid.versionError ?? "", /Informe uma versão numérica/);
  const corrected = reduce(invalid, { type: "version", value: "1.21.1" });
  assert.deepEqual(corrected, { ...previous, notice: "" });
  assert.equal(corrected.context, previous.context);
  assert.equal(corrected.messages, previous.messages);
  assert.equal(reduce(corrected, { type: "version", value: "1.21.1" }), corrected);
});
test("R2: rejecting a version removes the earlier success notice and preserves the active version", () => {
  let state = reduce(initialChatState(), { type: "mode", value: "FARM" });
  state = reduce(state, { type: "draft", value: "Rascunho mantido" });
  const accepted = reduce(state, { type: "version", value: "1.21.1" });
  assert.equal(accepted.notice, "Versão atualizada; seu rascunho foi mantido.");

  const rejected = reduce(accepted, { type: "version", value: "bad" });
  assert.match(rejected.versionError ?? "", /Informe uma versão numérica/);
  assert.deepEqual(rejected, { ...accepted, notice: "", versionError: rejected.versionError });
  assert.equal(rejected.context, accepted.context);
  assert.equal(reduce(rejected, { type: "version", value: "bad" }), rejected);
  assert.equal(reduce(rejected, { type: "version", value: "still-invalid" }), rejected);
  assert.deepEqual(reduce(rejected, { type: "version", value: "1.21.1" }), {
    ...accepted,
    notice: "",
  });
});
test("R2: a new notice is cleared even when the version error already exists", () => {
  let state = reduce(initialChatState(), { type: "version", value: "bad" });
  state = reduce(state, { type: "draft", value: "Mensagem local" });
  const sent = reduce(reduce(state, { type: "submit" }), { type: "complete" });
  assert.ok(sent.versionError);
  assert.match(sent.notice, /Mensagem exibida apenas nesta página/);

  const rejected = reduce(sent, { type: "version", value: "bad" });
  assert.deepEqual(rejected, { ...sent, notice: "" });
  assert.equal(rejected.messages, sent.messages);
  assert.equal(reduce(rejected, { type: "version", value: "bad" }), rejected);
});
test("R1-002/R1-008: correcting to another version preserves the sent context and draft", () => {
  let state = reduce(initialChatState(), { type: "version", value: "1.21.1" });
  state = reduce(state, { type: "draft", value: "Mensagem anterior" });
  state = reduce(reduce(state, { type: "submit" }), { type: "complete" });
  state = reduce(state, { type: "draft", value: "Próxima mensagem" });
  state = reduce(state, { type: "version", value: "bad" });
  assert.equal(state.context.game_version, "1.21.1");
  assert.ok(state.versionError);

  state = reduce(state, { type: "version", value: "1.20.2" });
  assert.equal(state.versionError, null);
  assert.equal(state.context.game_version, "1.20.2");
  assert.equal(state.messages[0]!.context.game_version, "1.21.1");
  assert.equal(state.draft, "Próxima mensagem");
  assert.match(state.notice, /perder validade/);
});
test("version and message validation clear their own errors, including an unspecified version", () => {
  let state = reduce(initialChatState(), { type: "version", value: "bad" });
  state = reduce(state, { type: "submit" });
  assert.ok(state.versionError);
  assert.equal(state.composerError?.kind, "message");

  state = reduce(state, { type: "version", value: null });
  assert.equal(state.versionError, null);
  assert.equal(state.composerError?.kind, "message");
  state = reduce(state, { type: "version", value: "bad" });
  state = reduce(state, { type: "draft", value: "a".repeat(MESSAGE_LIMIT) });
  assert.ok(state.versionError);
  assert.equal(state.composerError, null);
  state = reduce(state, { type: "submit" });
  assert.equal(state.pending?.text.length, MESSAGE_LIMIT);
  assert.equal(state.pending?.context.game_version, null);
});
test("empty or oversized messages fail locally without deleting drafts", () => {
  for (const draft of ["", "   ", "a".repeat(MESSAGE_LIMIT + 1)]) {
    const state = reduce(reduce(initialChatState(), { type: "draft", value: draft }), {
      type: "submit",
    });
    assert.equal(state.phase, "error");
    assert.equal(state.composerError?.kind, "message");
    assert.match(state.composerError.text, /Escreva uma mensagem de 1 a 4000 caracteres/);
    assert.equal(state.versionError, null);
    assert.equal(state.draft, draft);
    assert.equal(state.messages.length, 0);
  }
});
test("failed local preview preserves draft and retry appends once with captured context", () => {
  let state = reduce(initialChatState(), { type: "draft", value: "Olá" });
  state = reduce(state, { type: "submit" });
  assert.equal(state.phase, "previewing");
  assert.equal(reduce(state, { type: "submit" }), state);
  assert.equal(reduce(state, { type: "mode", value: "MODS" }), state);
  state = reduce(state, { type: "fail" });
  assert.equal(state.composerError?.kind, "preview");
  assert.equal(state.versionError, null);
  assert.equal(state.draft, "Olá");
  assert.equal(state.messages.length, 0);
  state = reduce(reduce(state, { type: "submit" }), { type: "complete" });
  state = reduce(state, { type: "complete" });
  assert.equal(state.messages.length, 1);
  assert.equal(state.draft, "");
  assert.match(state.notice, /Nenhuma pergunta foi enviada/);
});
test("new conversation cancels pending preview, clears messages and retains preferences", () => {
  let state = reduce(initialChatState(), { type: "mode", value: "FARM" });
  state = reduce(state, { type: "draft", value: "Não deve aparecer" });
  state = reduce(reduce(state, { type: "submit" }), { type: "new" });
  state = reduce(state, { type: "complete" });
  assert.equal(state.context.mode, "FARM");
  assert.equal(state.messages.length, 0);
  assert.equal(state.draft, "");
});
test("the calculator links to its route and the other five tools prepare preview questions", () => {
  assert.equal(TOOLS.length, 6);
  assert.deepEqual(
    TOOLS.filter((tool) => "href" in tool).map(({ id, href }) => ({ id, href })),
    [{ id: "materials", href: "/ferramentas/materiais" }],
  );
  for (const tool of TOOLS) {
    if ("href" in tool) continue;
    assert.ok(tool.limit.length > 20);
    const state = reduce(initialChatState(), {
      type: "prepare",
      text: tool.question,
      mode: tool.mode,
    });
    assert.equal(state.context.mode, tool.mode);
    assert.equal(state.draft, tool.question);
    assert.equal(state.messages.length, 0);
  }
});
