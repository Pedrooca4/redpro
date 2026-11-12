import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateCase, type EvaluationSuite } from "../scripts/ai-bench/report.ts";
import { assessCommands } from "../scripts/ai-command-audit/commands.ts";
import { replayCommandAudit } from "../scripts/ai-command-audit/replay.ts";

const archive = await readFile(new URL("./fixtures/command-audit-3b.json", import.meta.url));
const diagnostics = JSON.parse(
  await readFile(new URL("../scripts/ai-bench/cases.json", import.meta.url), "utf8"),
) as EvaluationSuite;
const expected = "/weather clear";

test("identifica um comando em texto, Markdown inline e blocos de código", () => {
  const positives = [
    ["Para limpar o clima, use /weather clear no chat.", "text"],
    ["O comando é **`/weather clear`**.", "inline"],
    ["Use:\n\n```mcfunction\n/weather  clear\n```", "block"],
    ["~~~\r\n/weather\tclear\r\n~~~", "block"],
  ];
  for (const [text, format] of positives) {
    const audit = assessCommands(text, expected);
    assert.equal(audit.mentions[0]?.format, format, text);
    assert.equal(audit.referenceTextPresent, true, text);
    assert.equal(audit.referenceParametersMatch, true, text);
    assert.equal(audit.recommendedReferencePresent, true, text);
  }
});

test("separa texto literal de parâmetros diferentes e ignora URLs", () => {
  const extra = assessCommands("Use `/weather clear 10`.", expected);
  assert.equal(extra.referenceTextPresent, true);
  assert.equal(extra.referenceParametersMatch, false);
  assert.equal(extra.recommendedReferencePresent, false);
  assert.equal(extra.mentions[0].parameters, "differs-from-reference");
  assert.equal(assessCommands("Use /weather cleared.", expected).referenceTextPresent, false);
  assert.equal(
    assessCommands("Veja https://example.org/weather clear.", expected).mentions.length,
    0,
  );
  assert.equal(
    assessCommands("Use `/give @p minecraft:stone 3`.", "/give @s minecraft:stone 3")
      .referenceParametersMatch,
    false,
  );
});

test("não conta comandos desaconselhados ou ilustrativos como recomendações", () => {
  const negatives = [
    "Não use `/weather clear`.",
    "Em vez de usar /weather clear, use /weather rain.",
    "Não se deve executar **/weather clear**.",
    "`/weather clear` é incorreto.",
    "O comando correto não é `/weather clear`.",
    "`/weather clear` — errado.",
    "Use `/weather rain`. `/weather clear` (errado).",
    "/weather clear não funciona.",
    "Evite:\n\n```mcfunction\n/weather clear\n```",
    "Exemplo incorreto:\n- `/weather clear`\n- `/weather clear`",
    "Exemplo do que não fazer: use `/weather clear`.",
    "Exemplo hipotético: `/weather clear`.",
  ];
  for (const text of negatives) {
    const audit = assessCommands(text, expected);
    assert.equal(audit.referenceTextPresent, true, text);
    assert.equal(audit.referenceParametersMatch, true, text);
    assert.equal(audit.recommendedReferencePresent, false, text);
  }
  const mention = assessCommands("Esta resposta cita `/weather clear`.", expected);
  assert.equal(mention.referenceTextPresent, true);
  assert.equal(mention.recommendedReferencePresent, false);
  assert.equal(
    assessCommands("Evite `/weather rain`; use `/weather clear`.", expected)
      .recommendedReferencePresent,
    true,
  );
  const conflicting = assessCommands("Não use `/weather clear`.\nUse `/weather clear`.", expected);
  assert.equal(conflicting.conflictingReferencePresentation, true);
  assert.equal(conflicting.recommendedReferencePresent, false);
  assert.equal(
    assessCommands("Evite `/weather clear 10`; use `/weather clear`.", expected)
      .recommendedReferencePresent,
    true,
  );
  assert.equal(
    assessCommands("O comando `/weather clear` não muda o horário.", expected)
      .recommendedReferencePresent,
    true,
  );
});

test("mantém o rótulo do exemplo e dá precedência à correção explícita", () => {
  const examples = [
    "Exemplo incorreto: primeiro, use `/weather clear`.",
    "Exemplo: primeiro use `/weather clear`.",
    "Comando correto: não use `/weather clear` neste caso.",
    "```mcfunction\n/weather clear\n```\n\nNão use esse comando.",
  ];
  for (const text of examples) {
    const result = assessCommands(text, expected);
    assert.equal(result.referenceParametersMatch, true, text);
    assert.equal(result.recommendedReferencePresent, false, text);
  }
  const correction = "Exemplo incorreto:\n- `/weather rain`\nComando correto: `/weather clear`.";
  const result = assessCommands(correction, expected);
  assert.deepEqual(
    result.mentions.map((item) => item.presentation),
    ["discouraged", "presented"],
  );
  assert.equal(result.recommendedReferencePresent, true);

  const conditional = "```\n/weather clear\n```\nNão use esse comando sem permissão.";
  assert.equal(assessCommands(conditional, expected).recommendedReferencePresent, true);
});

test("reconhece pontuação de prosa e mantém o namespace e argumentos em código", () => {
  const examples = [
    "Use /weather clear — para limpar o clima.",
    "Use /weather clear (sem alterar o horário).",
    "Use /weather clear: o horário é preservado.",
  ];
  for (const text of examples) {
    const result = assessCommands(text, expected);
    assert.equal(result.mentions[0]?.text, expected, text);
    assert.equal(result.recommendedReferencePresent, true, text);
  }
  const give = "/give @s minecraft:stone 3";
  assert.equal(
    assessCommands(`Use ${give}: entrega as pedras.`, give).recommendedReferencePresent,
    true,
  );
  assert.equal(
    assessCommands("Use `/weather clear — texto dentro do código`.", expected)
      .referenceParametersMatch,
    false,
  );
});

test("reavalia respostas arquivadas da 3B e mantém a nota histórica vinculada ao texto", async () => {
  const result = await replayCommandAudit(archive);
  const [base, rag] = result.runs;
  assert.deepEqual(base.summary.raw.legacy, { assessed: 4, matched: 0 });
  assert.deepEqual(rag.summary.raw.legacy, { assessed: 4, matched: 0 });
  assert.equal(base.summary.raw.referenceParametersMatch, 1);
  assert.equal(rag.summary.raw.referenceParametersMatch, 3);
  assert.equal(rag.summary.raw.recommendedReferencePresent, 3);
  assert.equal(base.summary.delivered.unavailable, 4);
  assert.equal(rag.summary.delivered.unavailable, 4);

  const contradictory = base.cases.find((item) => item.caseId === "CMD-J02")?.raw;
  assert.equal(contradictory?.metrics.recommendedReferencePresent, true);
  assert.equal(contradictory?.intentAssessment.status, "archived-factual-review");
  if (contradictory?.intentAssessment.status === "archived-factual-review") {
    assert.equal(contradictory.intentAssessment.factualGrade, "incorrect");
  }
  assert.equal(
    rag.cases.find((item) => item.caseId === "CMD-B02")?.raw?.metrics.referenceParametersMatch,
    false,
  );

  // Reexecute apenas o comparador congelado com os textos arquivados, sem gerar respostas.
  for (const { cases } of result.runs) {
    for (const row of cases) {
      const item = diagnostics.cases.find((candidate) => candidate.id === row.caseId);
      assert.ok(item && row.raw);
      const text = row.raw.text;
      const old = await evaluateCase(item, async () => ({
        text,
        latencyMs: 0,
        outputTokens: null,
        inputTokens: null,
        tokensPerSecond: null,
        truncated: false,
      }));
      assert.equal(old.answerSha256, row.raw.sha256);
      assert.equal(
        old.deterministic.exactCommandPresent,
        row.raw.metrics.legacyExactCommandPresent,
      );
    }
  }
});

test("replay mede saída bruta e entregue e registra hashes e procedências distintos", async () => {
  const fixture = JSON.parse(archive.toString("utf8"));
  const row = fixture.cases.find((item: { caseId: string }) => item.caseId === "CMD-B02").rag;
  const deliveredText = "Use `/effect @s speed 10 0` no chat. [MP-effect]";
  const input = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      mode: "real-local",
      dataset: { sha256: fixture.fingerprint.dataset },
      cases: [
        { ...row, delivered: { text: deliveredText, method: "rule", sourceIds: ["MP-effect"] } },
      ],
    }),
  );
  const result = await replayCommandAudit(input);
  const [run] = result.runs;
  const [answer] = run.cases;
  assert.equal(result.source.sha256, createHash("sha256").update(input).digest("hex"));
  assert.equal(answer.raw?.sha256, row.answerSha256);
  assert.equal(answer.raw?.provenance.method, "model");
  assert.equal(answer.delivered?.text, deliveredText);
  assert.equal(answer.delivered?.sha256, createHash("sha256").update(deliveredText).digest("hex"));
  assert.notEqual(answer.raw?.sha256, answer.delivered?.sha256);
  assert.deepEqual(answer.delivered?.provenance, { method: "rule", sourceIds: ["MP-effect"] });
  assert.equal(run.summary.raw.recommendedReferencePresent, 0);
  assert.equal(run.summary.delivered.recommendedReferencePresent, 1);
  assert.equal(answer.delivered?.intentAssessment.status, "not-assessed");
});

test("replay rejeita fonte fora do diagnóstico e hashes de texto ou nota inconsistentes", async () => {
  const fixture = JSON.parse(archive.toString("utf8"));
  const data = () => Buffer.from(JSON.stringify(fixture));
  const dataset = fixture.fingerprint.dataset;
  fixture.fingerprint.dataset = "0".repeat(64);
  await assert.rejects(replayCommandAudit(data()), /casos diagnósticos/);
  fixture.fingerprint.dataset = dataset;
  const text = fixture.cases[0].base.answer.text;
  fixture.cases[0].base.answer.text = "Texto divergente";
  await assert.rejects(replayCommandAudit(data()), /Saída bruta ou hash divergente/);
  fixture.cases[0].base.answer.text = text;
  fixture.cases[0].baseReview.answerSha256 = "0".repeat(64);
  await assert.rejects(replayCommandAudit(data()), /Nota histórica incompatível/);
});
