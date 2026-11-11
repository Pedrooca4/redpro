import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { groundAnswer } from "../scripts/ai-bench/grounding.ts";
import { createKnowledgeSearch } from "../scripts/ai-bench/knowledge.ts";

const search = createKnowledgeSearch(
  JSON.parse(readFileSync(new URL("../scripts/ai-bench/knowledge.json", import.meta.url), "utf8")),
);
const java = { edition: "Java", version: "1.21.5" } as const;
const bedrock = { edition: "Bedrock", version: "1.21.80" } as const;
const raw = "Texto bruto do modelo.";
const ask = (context: typeof java | typeof bedrock, question: string) => {
  const input = { ...context, question };
  return groundAnswer(input, search(input), raw);
};

test("receitas conhecidas usam grade e quantidades verificáveis", () => {
  const planks = ask(java, "Com 1 tronco de bétula, quantas tábuas saem?");
  assert.deepEqual(planks.sourceIds, ["MP-planks"]);
  assert.match(planks.text, /4 tábuas.*2×2/);
  const furnace = ask(bedrock, "Qual é a receita da fornalha de pedregulho?");
  assert.deepEqual(furnace.sourceIds, ["MP-furnace"]);
  assert.match(furnace.text, /8 pedregulhos.*centro vazio.*1 fornalha/);
});

test("a construção de /effect usa segundos e amplificador com base zero", () => {
  const answer = ask(bedrock, "Qual comando dá Velocidade III para mim por 17 segundos pelo chat?");
  assert.equal(answer.method, "rule");
  assert.match(answer.text, /`\/effect @s speed 17 2`/);
  assert.doesNotMatch(answer.text, /give/);
  for (const question of [
    "Comando de Velocidade II em mim por 30 ticks no chat?",
    "Comando de Velocidade II em mim por 30 segundos no chat ocultando partículas?",
    "Comando de Velocidade II em mim por 30 segundos no chat e limpe outros efeitos?",
  ]) {
    assert.equal(ask(bedrock, question).method, "model", question);
  }
});

test("repetidor tem saída estável zero sem entrada e 15 para entrada positiva", () => {
  for (const strength of [0, 1, 7, 15]) {
    const result = ask(
      bedrock,
      `Repetidor destravado, orientado corretamente, com potência ${strength} na entrada traseira. Qual a saída?`,
    );
    assert.equal(result.method, "rule");
    assert.ok(result.text.startsWith(`A saída frontal tem força ${strength ? 15 : 0}.`));
  }
  assert.equal(
    ask(
      bedrock,
      "Repetidor travado, orientado corretamente, com potência 7 na entrada traseira. Qual a saída?",
    ).method,
    "model",
  );
});

test("água no terreno e água no caldeirão continuam operações distintas", () => {
  const question = "Um balde de água derramado no chão do Nether deixa uma poça?";
  assert.match(ask(bedrock, question).text, /Nenhum bloco de água é colocado/);
  assert.equal(ask(bedrock, question.replace("chão", "caldeirão")).method, "model");
});

test("regras preservam resposta bruta fora do escopo e exigem ficha compatível", () => {
  const question = "Qual comando dá Velocidade III para mim por 17 segundos pelo chat?";
  assert.equal(ask(java, question).text, raw);
  assert.equal(ask(bedrock, question + " Quero usar no Java.").text, raw);
  assert.equal(ask(bedrock, question + " Estou na 1.21.81.").text, raw);
  const input = { ...bedrock, question, version: "1.21.81" };
  assert.equal(groundAnswer(input, search(input), raw).text, raw);
});

test("versão ausente exige esclarecimento sem entregar comando específico", () => {
  const input = { ...java, version: null, question: "Preciso de /summon com dados personalizados" };
  const answer = groundAnswer(input, search(input), "/summon entidade ~ ~ ~");
  assert.equal(answer.method, "clarification");
  assert.match(answer.text, /versão exata/);
  assert.doesNotMatch(answer.text, /\/summon/);
});
