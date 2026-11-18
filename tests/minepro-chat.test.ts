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
  type ChatState,
} from "../src/features/chat/state.ts";
import { guide } from "../src/features/assistant/guide.ts";

function receipt(state: ChatState) {
  const turn = state.pending;
  assert.ok(turn);
  return {
    type: "complete",
    id: turn.id,
    reply: guide({ message: turn.text, context: turn.context, followUp: turn.followUp }),
  } as const;
}

function send(state: ChatState) {
  const pending = reduce(state, { type: "submit" });
  return reduce(pending, receipt(pending));
}

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
  state = send(state);
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
  state = send(state);
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
  const sent = send(state);
  assert.ok(sent.versionError);
  assert.match(sent.notice, /limite do catálogo/);

  const rejected = reduce(sent, { type: "version", value: "bad" });
  assert.deepEqual(rejected, { ...sent, notice: "" });
  assert.equal(rejected.messages, sent.messages);
  assert.equal(reduce(rejected, { type: "version", value: "bad" }), rejected);
});
test("R1-002/R1-008: correcting to another version preserves the sent context and draft", () => {
  let state = reduce(initialChatState(), { type: "version", value: "1.21.1" });
  state = reduce(state, { type: "draft", value: "Mensagem anterior" });
  state = send(state);
  state = reduce(state, { type: "draft", value: "Próxima mensagem" });
  state = reduce(state, { type: "version", value: "bad" });
  assert.equal(state.context.game_version, "1.21.1");
  assert.ok(state.versionError);

  state = reduce(state, { type: "version", value: "1.20.2" });
  assert.equal(state.versionError, null);
  assert.equal(state.context.game_version, "1.20.2");
  assert.equal(state.messages[0]!.context.game_version, "1.21.1");
  assert.equal(state.messages[0]!.reply.context.game_version, "1.21.1");
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
test("failed request preserves draft and retry appends one reply with captured context", () => {
  let state = reduce(initialChatState(), { type: "draft", value: "Olá" });
  state = reduce(state, { type: "submit" });
  assert.equal(state.phase, "sending");
  assert.equal(reduce(state, { type: "submit" }), state);
  assert.equal(reduce(state, { type: "mode", value: "MODS" }), state);
  state = reduce(state, { type: "fail", id: state.pending!.id });
  assert.equal(state.composerError?.kind, "request");
  assert.equal(state.versionError, null);
  assert.equal(state.draft, "Olá");
  assert.equal(state.messages.length, 0);
  state = reduce(state, { type: "submit" });
  const completed = receipt(state);
  state = reduce(state, completed);
  state = reduce(state, completed);
  assert.equal(state.messages.length, 1);
  assert.equal(state.draft, "");
  assert.match(state.notice, /limite do catálogo/);
});
test("new conversation discards delayed success and failure, including during a new request", () => {
  let state = reduce(initialChatState(), { type: "mode", value: "FARM" });
  state = reduce(state, { type: "draft", value: "Não deve aparecer" });
  state = reduce(state, { type: "submit" });
  const stale = receipt(state);
  state = reduce(state, { type: "new" });
  state = reduce(state, stale);
  assert.equal(state.context.mode, "FARM");
  assert.equal(state.messages.length, 0);
  assert.equal(state.draft, "");
  state = reduce(state, { type: "draft", value: "Nova pergunta" });
  state = reduce(state, { type: "submit" });
  assert.notEqual(state.pending?.id, stale.id);
  assert.equal(reduce(state, stale), state);
  assert.equal(reduce(state, { type: "fail", id: stale.id }), state);
  state = reduce(state, receipt(state));
  assert.deepEqual(
    state.messages.map(({ text }) => text),
    ["Nova pergunta"],
  );
});
test("follow-up stays in the conversation and uses only the matching context", () => {
  let state = reduce(initialChatState(), { type: "version", value: "1.21.1" });
  state = reduce(state, { type: "draft", value: "Quero minerar diamantes" });
  const asked = send(state);
  assert.equal(asked.messages[0]!.reply.type, "CLARIFICATION");
  const next = reduce(asked, { type: "draft", value: "Ferro" });
  const pending = reduce(next, { type: "submit" });
  assert.equal(pending.pending?.followUp?.field, "pickaxe");
  const completed = reduce(pending, receipt(pending));
  assert.equal(completed.messages[1]!.reply.type, "ANSWER");
  const newMode = reduce(next, { type: "mode", value: "SURVIVAL" });
  assert.equal(reduce(newMode, { type: "submit" }).pending?.followUp, undefined);
  const newVersion = reduce(next, { type: "version", value: "1.20.1" });
  assert.equal(reduce(newVersion, { type: "submit" }).pending?.followUp, undefined);
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

for (const [message, kind] of [
  ["Planeje uma base 21 × 21.", "ANSWER"],
  ["Meu pistão não funciona como esperado.", "CLARIFICATION"],
] as const) {
  test("C-DEF-002: successive " + kind + " turns publish distinguishable notices", () => {
    const initial = reduce(initialChatState(), { type: "version", value: "1.21.1" });
    const first = send(reduce(initial, { type: "draft", value: message }));
    const second = send(reduce(first, { type: "draft", value: message }));
    assert.deepEqual(
      second.messages.map(({ reply }) => reply.type),
      [kind, kind],
    );
    assert.notEqual(first.notice, second.notice);
    assert.match(first.notice, /^Resposta 1\./);
    assert.match(second.notice, /^Resposta 2\./);
  });
}
