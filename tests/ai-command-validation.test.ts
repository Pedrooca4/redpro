import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveQuestion } from "../scripts/ai-command-validation/questions.ts";
import { replayValidation } from "../scripts/ai-command-validation/replay.ts";
import { measureRobustness } from "../scripts/ai-command-validation/robustness.ts";
import { validateCandidate, validateIntent } from "../scripts/ai-command-validation/validate.ts";

const java = { edition: "Java", version: "1.21.5" };
const bedrock = { edition: "Bedrock", version: "1.21.80" };
const region = { from: ["-8", "70", "4"], to: ["-6", "72", "7"], block: "glass" };

test("mantém os 65 contratos de desenvolvimento da 3E-D", async () => {
  const result = await measureRobustness();
  assert.equal(result.total.total, 65);
  assert.equal(result.total.covered, 50);
  assert.equal(result.total.falsePositives, 0);
  assert.equal(result.total.falseNegatives, 0);
  assert.deepEqual(result.mismatches, []);
});

test("verifica as paráfrases e os limites com a bateria de desenvolvimento da 3E-E", async () => {
  const result = await measureRobustness(undefined, undefined, "3ee");
  assert.equal(result.total.total, 38);
  assert.equal(result.total.covered, 21);
  assert.equal(result.total.falsePositives, 0);
  assert.equal(result.total.falseNegatives, 0);
  assert.deepEqual(result.mismatches, []);
});

test("interpreta clima em PT-BR e preserva o horário em Java e Bedrock", () => {
  const examples = [
    [java, "No Java 1.21.5, como tirar a chuva, sem mexer no relógio?", "/weather clear"],
    [bedrock, "Deixe o céu limpo, por favor.", "/weather clear"],
    [java, "Gostaria de fazer chover.", "/weather rain"],
    [bedrock, "Como eu posso ativar uma tempestade?", "/weather thunder"],
    [bedrock, "Como ver o clima atual?", "/weather query"],
  ] as const;
  for (const [context, question, command] of examples) {
    const result = resolveQuestion(context, question);
    assert.equal(result.status, "ready", question);
    assert.equal(result.command, command);
    assert.match(result.message, /preserva o horário/);
    assert.doesNotMatch(JSON.stringify(result), /\/time\b/);
  }
  const ambiguous = resolveQuestion(java, "Quero mudar o clima.");
  assert.equal(ambiguous.status, "clarify");
  assert.deepEqual(ambiguous.fields, ["clima desejado"]);
  assert.equal(resolveQuestion({}, "No Java 1.21.5, como tirar a chuva?").status, "ready");
  const missingVersion = resolveQuestion({}, "No Bedrock, como tirar a chuva?");
  assert.equal(missingVersion.status, "clarify");
  assert.deepEqual(missingVersion.fields, ["versão exata"]);
  assert.equal(validateCandidate(java, "/weather query").status, "invalid");
  assert.equal(validateCandidate(bedrock, "/weather rain 300").status, "ready");
  assert.equal(validateCandidate(bedrock, "/weather rain 15s").status, "invalid");
  assert.equal(validateCandidate(bedrock, "/weather rain 1000001").status, "invalid");
  assert.equal(validateCandidate(bedrock, "/weather query 0").status, "invalid");
  assert.equal(validateCandidate(java, "/weather clear 10s").status, "ready");
  assert.equal(validateCandidate(java, "/weather reset").status, "invalid");
});

test("responde ao preenchimento com campos separados e solicita só o que falta", () => {
  const full =
    "Preencha a região com vidro; primeiro canto: (-8, 70, 4); segundo canto: (-6, 72, 7).";
  for (const context of [java, bedrock]) {
    const result = resolveQuestion(context, full);
    assert.equal(result.status, "ready");
    assert.equal(result.command, "/fill -8 70 4 -6 72 7 minecraft:glass replace");
    assert.match(result.message, /36 posições.*substituir/);
  }
  const partial = resolveQuestion(
    bedrock,
    "Preciso preencher a região; bloco: minecraft:glass; canto inicial: -8 70 4.",
  );
  assert.equal(partial.status, "clarify");
  assert.deepEqual(partial.fields, ["segundo canto XYZ"]);
  assert.equal("command" in partial, false);
  const missingContext = resolveQuestion({ edition: "Bedrock" }, full);
  assert.equal(missingContext.status, "clarify");
  assert.deepEqual(missingContext.fields, ["versão exata"]);
  const missingBlock = resolveQuestion(
    bedrock,
    "Preencha a região; canto inicial: -8 70 4; canto final: -6 72 7.",
  );
  assert.equal(missingBlock.status, "clarify");
  assert.deepEqual(missingBlock.fields, ["ID do bloco de destino"]);
  const keep = resolveQuestion(
    bedrock,
    "Preencha o espaço com pedra sem apagar os blocos existentes; primeiro canto: -8 70 4; segundo canto: -6 72 7.",
  );
  assert.equal(keep.status, "ready");
  assert.match(keep.command, /minecraft:stone keep$/);
});

test("valida bloco, edição, versão e argumentos em vez de procurar texto literal", () => {
  const prefix = "/fill -8 70 4 -6 72 7";
  const ready = validateCandidate(bedrock, `${prefix} glass keep`);
  assert.equal(ready.status, "ready");
  assert.equal(ready.command, `${prefix} minecraft:glass keep`);
  for (const block of ["minecraft:diamond_sword", "x y z"]) {
    assert.equal(validateCandidate(bedrock, `${prefix} ${block}`).status, "invalid");
  }
  assert.equal(validateCandidate(bedrock, `${prefix} exemplo:bloco`).status, "outside-scope");
  assert.equal(validateCandidate(bedrock, `${prefix} air keep`).status, "invalid");
  assert.equal(validateCandidate(bedrock, `${prefix} glass strict`).status, "invalid");
  assert.equal(validateCandidate(java, `${prefix} glass strict`).status, "outside-scope");
  assert.equal(
    validateCandidate({ ...bedrock, version: "1.20.80" }, `${prefix} glass`).status,
    "outside-scope",
  );
  assert.equal(
    validateCandidate({ edition: "Education", version: "1.21.80" }, `${prefix} glass`).status,
    "outside-scope",
  );
  assert.equal(validateCandidate(bedrock, "/fill -8 70 x -6 72 7 glass").status, "invalid");
  assert.equal(validateCandidate(bedrock, "/fill -8 70 -6 72 7 glass").status, "invalid");
  assert.equal(validateCandidate(bedrock, "/fill ~ ~ ~ ~3 ~2 ~1 glass").status, "outside-scope");
  assert.equal(validateCandidate(bedrock, "/fill -8 320 4 -6 321 7 glass").status, "caution");
  assert.equal(validateCandidate(java, `${prefix} glass replace dirt`).status, "outside-scope");
  assert.equal(
    validateCandidate(java, `${prefix} oak_planks[waterlogged=true]`).status,
    "outside-scope",
  );
});

test("retém operações destrutivas até confirmação e distingue borda de interior", () => {
  for (const change of [{ block: "air" }, { mode: "hollow" }, { mode: "destroy" }]) {
    const intent = { command: "fill" as const, ...region, ...change };
    const blocked = validateIntent(java, intent);
    assert.equal(blocked.status, "caution");
    assert.deepEqual(blocked.fields, ["efeito destrutivo"]);
    assert.equal("command" in blocked, false);
    const confirmed = validateIntent(java, { ...intent, acceptDestructive: true });
    assert.equal(confirmed.status, "ready");
    assert.match(confirmed.message, /apagar blocos|esvazia o interior|Quebra os blocos/);
  }
  const outline = validateIntent(bedrock, { command: "fill", ...region, mode: "outline" });
  assert.equal(outline.status, "ready");
  assert.match(outline.message, /borda e preserva o interior/);
  assert.equal(
    validateIntent(java, { command: "fill", ...region, mode: "replace", preserveExisting: true })
      .status,
    "caution",
  );
  assert.equal(
    validateIntent(java, { command: "fill", ...region, to: ["100", "200", "300"] }).status,
    "caution",
  );
});

test("deixa pedidos compostos, negados e com restrições fora da regra", () => {
  const examples = [
    "Quero tirar a chuva e depois usar /time set noon.",
    "Não limpe o clima.",
    "Quero deixar o céu limpo e remover os inimigos.",
    "Quando estiver de noite, limpe o clima.",
    "Pare a chuva por cinco minutos.",
    "Como limpar o clima no Bedrock 1.21.80?",
    "É verdade que /weather clear muda a hora?",
    "Quero preencher uma sala para retirar o teto.",
    "Preencha a região com vidro apenas na metade de cima.",
    "Preencha a região com vidro; primeiro canto: -8 70 4; canto inicial: -7 70 4.",
    "Quero preencher uma sala com vidro e proteger a entrada.",
  ];
  for (const question of examples)
    assert.equal(resolveQuestion(java, question).status, "outside-scope", question);
});

test("rejeita entrada fora do arquivo diagnóstico antes de ler referências", async () => {
  await assert.rejects(replayValidation(Buffer.from('{"scope":"unrelated"}')), /24 diagnósticos/);
});

test("reaplica critérios aos dois casos históricos sem invocar o modelo", async () => {
  const read = async (path: string) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  const [diagnostic, comparison, fill] = await Promise.all([
    read("../scripts/ai-bench/cases.json"),
    read("./fixtures/command-audit-3b.json"),
    read("./fixtures/command-validation-fill-3b.json"),
  ]);
  const weather = comparison.cases.find((row: { caseId: string }) => row.caseId === "CMD-J02");
  const cases = diagnostic.cases.map(({ id }: { id: string }) =>
    id === weather.caseId ? weather : id === fill.caseId ? fill : { caseId: id },
  );
  const result = await replayValidation(Buffer.from(JSON.stringify({ ...comparison, cases })));
  for (const row of result.cases) {
    assert.equal(row.prototype.assessment.outcome, "pass");
    assert.deepEqual(
      row.comparisons.map((item) => item.change),
      ["improved", "maintained"],
    );
  }
  assert.deepEqual(result.cases[0].comparisons[0].before.issues, ["altera-horario"]);
  assert.deepEqual(result.cases[1].comparisons[0].before.issues, [
    "parametros-de-preenchimento-incorretos",
    "regiao-nao-fornecida-pelo-jogador",
  ]);
  assert.equal("command" in result.cases[1].prototype, false);
});
