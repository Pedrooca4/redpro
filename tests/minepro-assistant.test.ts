import assert from "node:assert/strict";
import test from "node:test";
import {
  isAssistantReply,
  parseAssistantRequest,
  type AssistantRequest,
} from "../src/features/assistant/contracts.ts";
import { guide } from "../src/features/assistant/guide.ts";
import type { MinecraftContext } from "../src/features/chat/config.ts";

const java: MinecraftContext = { edition: "JAVA", game_version: "1.21.1", mode: "RED" };
const bedrock: MinecraftContext = { edition: "BEDROCK", game_version: "1.21.0", mode: "RED" };

function run(message: string, context = java, followUp?: AssistantRequest["followUp"]) {
  const input = parseAssistantRequest({ message, context, followUp });
  assert.ok(input);
  const result = guide(input);
  assert.ok(isAssistantReply(result));
  assert.deepEqual(result.context, context);
  return result;
}

test("the six guide flows give structured, verifiable advice for Java and Bedrock", () => {
  for (const context of [java, bedrock]) {
    const queries = [
      ["RED", "Meu pistão não estende. Como testo o sinal?", "red-piston"],
      ["FARM", "Quero montar uma farm de ferro", "farm-iron"],
      ["BUILDER", "Planeje uma base 21 × 21", "builder-base-21"],
      ["COMMAND", "Como listar os comandos com /help?", "command-help"],
      [
        "MODS",
        context.edition === "JAVA"
          ? "Meu jogo fecha ao iniciar com mods Fabric"
          : "Um add-on de mundo não ativa",
        "mods-triage",
      ],
      ["SURVIVAL", "Quero minerar diamantes e uso picareta de pedra", "survival-mining"],
    ] as const;
    for (const [mode, message, procedureId] of queries) {
      const answer = run(message, { ...context, mode });
      assert.equal(answer.type, "ANSWER", message);
      assert.equal(answer.procedureId, procedureId, message);
      assert.ok(answer.answer.steps?.length);
      assert.ok(answer.answer.verification);
      assert.ok(answer.answer.warnings?.length);
      assert.match(answer.answer.compatibility ?? "", new RegExp(context.game_version!));
      if (mode !== "BUILDER") {
        assert.equal(answer.verification, "DOCUMENTED");
        assert.ok(answer.sources.every(({ url }) => new URL(url).protocol === "https:"));
        assert.ok(answer.sources.length);
      }
    }
  }
});

test("edition-dependent requirements are presented independently", () => {
  const javaFarm = run("Como montar uma farm de ferro?", java);
  const bedrockFarm = run("Como montar uma farm de ferro?", bedrock);
  assert.equal(javaFarm.type, "ANSWER");
  assert.equal(bedrockFarm.type, "ANSWER");
  assert.match(javaFarm.answer.prerequisites?.join(" ") ?? "", /dormido/);
  assert.match(bedrockFarm.answer.prerequisites?.join(" ") ?? "", /postos de trabalho/);
  assert.doesNotMatch(bedrockFarm.answer.prerequisites?.join(" ") ?? "", /dormido/);
  const javaCommand = run("Como uso /help?", java);
  const bedrockCommand = run("Como uso /help?", bedrock);
  assert.equal(javaCommand.type, "ANSWER");
  assert.equal(bedrockCommand.type, "ANSWER");
  assert.doesNotMatch(javaCommand.answer.steps?.join(" ") ?? "", /\/help 2/);
  assert.match(bedrockCommand.answer.steps?.join(" ") ?? "", /\/help 2/);
});

test("mode informs ambiguity and scope without routing explicit questions to the wrong procedure", () => {
  const explicit = run("Como uso /help?", { ...java, mode: "FARM" });
  assert.equal(explicit.type, "ANSWER");
  assert.equal(explicit.procedureId, "command-help");
  assert.equal(explicit.context.mode, "FARM");
  const ambiguous = run("Meu pistão não estende e quero montar uma farm de ferro", {
    ...java,
    mode: "FARM",
  });
  assert.equal(ambiguous.type, "CLARIFICATION");
  assert.match(ambiguous.text, /farm de ferro ou diagnóstico de pistões/);
  assert.equal(ambiguous.followUp, undefined);
  for (const input of [
    "Escreva um poema sobre o pistão que não estende",
    "Meu pistão do carro não funciona",
    "Execute /kill no meu servidor",
    "Qual é a melhor seed?",
    "Meu cachorro comeu um ferro",
    "Quero planejar uma base 21 x 21 ou 50 x 50",
  ]) {
    const reply = run(input);
    assert.equal(reply.type, "UNSUPPORTED", input);
    assert.match(reply.text, /não há orientação validada/);
  }
});

test("absent, unsupported and conflicting versions never receive unverified instructions", () => {
  const missing = run("Quero montar uma farm de ferro", { ...java, game_version: null });
  assert.equal(missing.type, "CLARIFICATION");
  assert.equal(missing.needsVersion, true);
  assert.match(missing.text, /1\.21\.1/);
  const unsupported = run("Quero montar uma farm de ferro", { ...bedrock, game_version: "1.21.1" });
  assert.equal(unsupported.type, "UNSUPPORTED");
  assert.match(unsupported.text, /BedMine 1\.21\.0/);
  assert.equal(run("Quero montar uma farm de ferro para Bedrock", java).type, "CLARIFICATION");
  assert.equal(run("Quero montar uma farm de ferro no Bedrock", java).type, "CLARIFICATION");
  assert.equal(
    run("Quero montar uma farm de ferro no Minecraft 1.20.1", java).type,
    "CLARIFICATION",
  );
});

test("clarifications accept bounded follow-up details without transferring unrelated instructions", () => {
  const piston = run("Meu pistão não funciona como esperado");
  assert.equal(piston.type, "CLARIFICATION");
  assert.equal(piston.followUp?.field, "piston");
  const diagnosed = run("Não retrai", java, piston.followUp);
  assert.equal(diagnosed.type, "ANSWER");
  assert.match(diagnosed.answer.steps?.join(" ") ?? "", /outra fonte de sinal/);

  const farm = run("Minha farm de ferro não funciona");
  assert.equal(farm.type, "CLARIFICATION");
  assert.equal(farm.followUp?.field, "farm");
  assert.equal(run("O baú vazio", java, farm.followUp).type, "ANSWER");
  const newTopic = run("Como uso /help?", java, farm.followUp);
  assert.equal(newTopic.type, "ANSWER");
  assert.equal(newTopic.procedureId, "command-help");

  const mod = run("Recebi erro de dependência em um mod");
  assert.equal(mod.type, "CLARIFICATION");
  assert.equal(mod.followUp?.field, "setup");
  const sanitized = run("Uso Fabric", java, mod.followUp);
  assert.equal(sanitized.type, "ANSWER");
  assert.match(sanitized.answer.warnings?.join(" ") ?? "", /frase sanitizada/);
  assert.equal(run("Meu jogo fecha ao iniciar com mods Forge").type, "UNSUPPORTED");
});

test("mining clarification preserves the resource and checks the actual tool tier", () => {
  const initial = run("Quero minerar diamantes");
  assert.equal(initial.type, "CLARIFICATION");
  assert.equal(initial.followUp?.field, "pickaxe");
  assert.deepEqual(initial.followUp?.details, { resource: "diamond" });
  const iron = run("Ferro", java, initial.followUp);
  assert.equal(iron.type, "ANSWER");
  assert.match(iron.answer.text, /atende ao requisito.*diamante/);
  const gold = run("Ouro", java, initial.followUp);
  assert.equal(gold.type, "ANSWER");
  assert.match(gold.answer.text, /prepare uma picareta de ferro/);
  assert.equal(run("Qual o preço do ferro?", java, initial.followUp).type, "UNSUPPORTED");
  assert.equal(
    run("Escreva um poema com uma picareta de ferro", java, initial.followUp).type,
    "UNSUPPORTED",
  );
  const resource = run("Quero minerar diamante ou ferro e uso picareta de pedra");
  assert.equal(resource.type, "CLARIFICATION");
  assert.equal(resource.followUp?.field, "resource");
  assert.equal(run("Qual o preço do ferro?", java, resource.followUp).type, "UNSUPPORTED");
  assert.equal(run("Ferro primeiro", java, resource.followUp).type, "ANSWER");
});

test("the 21 × 21 plan separates an exact count from a conditional estimate", () => {
  const answer = run("Calcule os materiais para uma base 21 por 21");
  assert.equal(answer.type, "ANSWER");
  assert.equal(answer.verification, "CALCULATED");
  assert.deepEqual(
    answer.answer.materials?.map(({ quantity, estimated }) => [quantity, estimated]),
    [
      [441, false],
      [240, true],
    ],
  );
  assert.match(answer.answer.warnings?.join(" ") ?? "", /sem aberturas/);
});

test("request and reply validators reject unknown fields, unbounded inputs and unsafe evidence", () => {
  assert.ok(parseAssistantRequest({ message: "x".repeat(4000), context: java }));
  for (const invalid of [
    ["Quero minerar diamantes", java],
    { message: "   ", context: java },
    { message: "x".repeat(4001), context: java },
    { message: "a", context: { ...java, mode: "AI" } },
    { message: "a", context: { ...java, edition: "java" } },
    { message: "a", context: { ...java, game_version: "latest" } },
    { message: "a", context: { ...java, extra: true } },
    { message: "a", context: java, history: [] },
    {
      message: "a",
      context: java,
      followUp: { procedureId: "command-help", field: "setup", details: {} },
    },
    {
      message: "a",
      context: java,
      followUp: {
        procedureId: "survival-mining",
        field: "pickaxe",
        details: { resource: "<script>" },
      },
    },
  ])
    assert.equal(parseAssistantRequest(invalid), null);

  const result = run("Como uso /help?");
  assert.equal(result.type, "ANSWER");
  assert.equal(
    isAssistantReply({ ...result, sources: [{ title: "Fonte", url: "javascript:alert(1)" }] }),
    false,
  );
  assert.equal(isAssistantReply({ ...result, context: { ...java, game_version: null } }), false);
  assert.equal(isAssistantReply({ ...result, sources: [] }), false);
  assert.equal(isAssistantReply({ ...result, type: "ERROR" }), false);
});

for (const [message, context] of [
  ["Quero montar uma farm de ferro para Minecraft Bedrock 1.21.0.", java],
  ["Meu pistão comum não estende em Java 1.20.1. Como testo?", java],
  ["Meu pistão comum não estende no Minecraft Java 1.21.1. Como testo?", bedrock],
  ["Meu pistão comum não estende no Minecraft Java. Como testo?", bedrock],
] as const) {
  test("C-DEF-001: asks for context when the text conflicts: " + message, () => {
    const reply = run(message, context);
    assert.equal(reply.type, "CLARIFICATION");
    assert.match(reply.text, /edição ou a versão/);
    assert.equal(reply.followUp, undefined);
  });
}

test("C-DEF-001: asks which edition or version to use in an ambiguous comparison", () => {
  for (const message of [
    "Como montar uma farm de ferro em Java ou Bedrock?",
    "Como montar uma farm de ferro em Java, ou Bedrock?",
    "Como montar uma farm de ferro em Java x Bedrock?",
    "Como montar uma farm de ferro no Java e no Bedrock?",
    "Quero montar uma farm de ferro com as versões 1.21.1 e 1.20.1.",
    "Quero montar uma farm de ferro em Java 1.21.1 ou 1.20.1.",
    "Quero montar uma farm de ferro em Java 1.21.1 ou na versão 1.20.1.",
    "Quero montar uma farm de ferro no Minecraft 1.21.1 e no Minecraft 1.20.1.",
  ]) {
    const reply = run(message);
    assert.equal(reply.type, "CLARIFICATION", message);
    assert.match(reply.text, /mais de uma edição ou versão/);
    assert.equal(reply.followUp, undefined);
  }
});

test("C-DEF-001: accepts matching context without inferring it from incidental words", () => {
  for (const [message, context, procedure] of [
    ["Quero montar uma farm de ferro para Minecraft Bedrock 1.21.0.", bedrock, "farm-iron"],
    ["Meu pistão comum não estende no Minecraft Java 1.21.1. Como testo?", java, "red-piston"],
    ["Como montar uma farm de ferro? Uso JavaMine, versão 1.21.1.", java, "farm-iron"],
    ["Quero montar uma farm de ferro. O tutorial menciona Bedrock.", java, "farm-iron"],
    [
      "Meu jogo fecha com mods Fabric. A versão do loader é 0.16.10 e o tutorial menciona Bedrock.",
      java,
      "mods-triage",
    ],
  ] as const) {
    const reply = run(message, context);
    assert.equal(reply.type, "ANSWER", message);
    assert.equal(reply.procedureId, procedure);
  }
});

for (const context of [java, bedrock]) {
  const survival = { ...context, mode: "SURVIVAL" } as const;
  test("C-DEF-003: a denied tool leaves its material open in " + context.edition, () => {
    const reply = run("Quero minerar diamantes, mas não uso picareta de ferro.", survival);
    assert.equal(reply.type, "CLARIFICATION");
    assert.equal(reply.followUp?.field, "pickaxe");
    assert.deepEqual(reply.followUp?.details, { resource: "diamond" });
  });

  test("C-DEF-003: a different affirmed tool is available in " + context.edition, () => {
    const reply = run(
      "Quero minerar ferro. Não tenho picareta de ferro, mas uso picareta de pedra.",
      survival,
    );
    assert.equal(reply.type, "ANSWER");
    assert.match(reply.answer.text, /atende ao requisito para obter ferro/);
  });

  test(
    "C-DEF-003: affirmative and absent tools yield different guidance in " + context.edition,
    () => {
      const iron = run("Quero minerar diamantes e uso picareta de ferro.", survival);
      assert.equal(iron.type, "ANSWER");
      assert.match(iron.answer.text, /atende ao requisito para obter diamante/);

      const gold = run("Quero minerar diamantes e uso picareta de ouro.", survival);
      assert.equal(gold.type, "ANSWER");
      assert.match(gold.answer.text, /prepare uma picareta de ferro/);

      const noTool = run("Quero minerar diamantes, mas não tenho picareta.", survival);
      assert.equal(noTool.type, "ANSWER");
      assert.match(noTool.answer.text, /não tem uma picareta/);
      assert.match(noTool.answer.text, /prepare uma picareta de ferro/);
    },
  );

  test(
    "C-DEF-003: a contradiction or material alternatives require clarification in " +
      context.edition,
    () => {
      for (const message of [
        "Quero minerar diamantes. Tenho picareta de ferro e não uso picareta de ferro.",
        "Quero minerar diamantes e uso picareta de ferro ou de ouro.",
        "Quero minerar diamantes. Não uso picareta de ferro nem picareta de ouro.",
        "Quero minerar diamantes, mas não uso picareta de cobre.",
      ]) {
        const reply = run(message, survival);
        assert.equal(reply.type, "CLARIFICATION", message);
        assert.equal(reply.followUp?.field, "pickaxe");
      }
      const correction = run(
        "Quero minerar diamantes. Uso picareta de ferro, quer dizer, uso picareta de ouro.",
        survival,
      );
      assert.equal(correction.type, "ANSWER");
      assert.match(correction.answer.text, /prepare uma picareta de ferro/);
    },
  );

  test("C-DEF-003: a follow-up cannot preserve a newly denied tool in " + context.edition, () => {
    const needsOre = run("Quero minerar diamante ou ferro e tenho picareta de ferro.", survival);
    assert.equal(needsOre.type, "CLARIFICATION");
    assert.equal(needsOre.followUp?.field, "resource");
    const needsTool = run(
      "Quero minerar diamantes, mas não uso picareta de ferro.",
      survival,
      needsOre.followUp,
    );
    assert.equal(needsTool.type, "CLARIFICATION");
    assert.equal(needsTool.followUp?.field, "pickaxe");
    assert.deepEqual(needsTool.followUp?.details, { resource: "diamond" });

    const negated = run("Não tenho picareta de ferro.", survival, needsTool.followUp);
    assert.equal(negated.type, "CLARIFICATION");
    assert.equal(negated.followUp?.field, "pickaxe");
    const corrected = run(
      "Não uso picareta de ouro, mas uso picareta de ferro.",
      survival,
      negated.followUp,
    );
    assert.equal(corrected.type, "ANSWER");
    assert.match(corrected.answer.text, /atende ao requisito para obter diamante/);
  });

  test("C-DEF-004: Silk Touch still needs the correct tool tier in " + context.edition, () => {
    for (const [material, expectedAdvice] of [
      ["ferro", /atende ao requisito/],
      ["ouro", /prepare uma picareta de ferro/],
    ] as const) {
      const reply = run(
        "Quero minerar diamantes e uso picareta de " + material + " com Toque Suave.",
        survival,
      );
      assert.equal(reply.type, "ANSWER");
      assert.match(reply.answer.text, expectedAdvice);
      assert.match(
        reply.answer.verification ?? "",
        /Toque Suave requer uma picareta de nível adequado/,
      );
      assert.match(reply.answer.verification ?? "", /não rende drop/);
    }
  });
}
