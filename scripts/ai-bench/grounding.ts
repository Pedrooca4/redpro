import type { Retrieval } from "./knowledge.ts";

type Answer = { method: "rule" | "clarification" | "model"; text: string; sourceIds: string[] };
type Question = { edition: "Java" | "Bedrock"; version: string | null; question: string };

// Each rule answers a single, supported operation. Ambiguous or compound requests
// remain outside the rule's scope. The caller always keeps the raw generation.
export function groundAnswer(
  { edition, version, question }: Question,
  retrieval: Retrieval,
  text: string,
): Answer {
  const ask = question
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  if (!version && /(?:^|\s)\/(?:give|effect|fill|execute|summon|setblock|data|tp)\b/u.test(ask)) {
    return {
      method: "clarification",
      text: `Qual é a versão exata do Minecraft ${edition}? Preciso dela antes de indicar a sintaxe do comando.`,
      sourceIds: [],
    };
  }

  const modelAnswer: Answer = { method: "model", text, sourceIds: [] };
  const otherEdition = edition === "Java" ? "bedrock" : "java";
  if (
    !version ||
    new RegExp(`\\b${otherEdition}\\b`, "u").test(ask) ||
    [...ask.matchAll(/\b\d+\.\d+(?:\.\d+)?\b/gu)].some(([mentioned]) => mentioned !== version) ||
    /\b(?:nao|exceto|addon|mod|plugin|creative|criativo|compare|ou|alem|tambem|mas)\b/u.test(ask) ||
    (ask.match(/\?/g)?.length ?? 0) > 1
  ) {
    return modelAnswer;
  }

  const has = (id: string) => retrieval.cards.some((card) => card.id === id);
  const rule = (id: string, answer: string): Answer => ({
    method: "rule",
    text: `${answer} [${id}]`,
    sourceIds: [id],
  });

  if (
    has("MP-planks") &&
    /\b(?:um|1) tronco de (?:carvalho(?: escuro)?|betula|pinheiro|acacia|selva|mangue|cerejeira)\b/u.test(
      ask,
    ) &&
    /\bquantas tabuas\b/u.test(ask) &&
    !/\b(?:pilha|stacks?|restam|sobram|preciso de|necessito de) \d/u.test(ask) &&
    [...ask.matchAll(/\b\d+\b/gu)].every(([number]) => number === "1")
  ) {
    return rule(
      "MP-planks",
      "Um tronco rende 4 tábuas do mesmo tipo. Uma célula da grade 2×2 do inventário basta.",
    );
  }

  if (
    has("MP-furnace") &&
    /^(?:como (?:monto|faco|fabrico) (?:uma |a )?fornalha(?: comum)? (?:so )?com pedregulho|qual e a receita da fornalha (?:com|de) pedregulho)\?$/u.test(
      ask,
    )
  ) {
    return rule(
      "MP-furnace",
      "Na grade 3×3 da bancada, coloque 8 pedregulhos, um em cada célula ao redor do centro. Deixe o centro vazio. A receita rende 1 fornalha.",
    );
  }

  const effect = /\bvelocidade (i{1,3}|iv)\b/u.exec(ask);
  const duration = /(?<![-+.,\d])\b([1-9]\d{0,3}) segundos?\b/u.exec(ask);
  if (
    edition === "Bedrock" &&
    has("MP-effect") &&
    effect &&
    duration &&
    /\bcomando\b/u.test(ask) &&
    /(?:\b(?:em mim|a mim|para mim)\b|(?:^|\s)@s\b)/u.test(ask) &&
    /\b(?:no chat|pelo chat)[.!?]?$/u.test(ask) &&
    !/\b(?:particulas|ocultar|comando de bloco|todos|infinito|remover|limpar)\b/u.test(ask) &&
    (ask.match(/\b\d+\b/gu)?.length ?? 0) === 1
  ) {
    const amplifier = ["i", "ii", "iii", "iv"].indexOf(effect[1]);
    return rule(
      "MP-effect",
      `No chat, com cheats e permissão:\n\n\`/effect @s speed ${Number(duration[1])} ${amplifier}\`\n\nA duração está em segundos e o amplificador começa em 0.`,
    );
  }

  const signal = /\b(?:forca|potencia) (\d|1[0-5]) (?:atras|na entrada traseira)\b/u.exec(ask);
  if (
    edition === "Bedrock" &&
    has("MP-bedrock-repeater") &&
    signal &&
    /\b(?:bem orientado|orientado corretamente)\b/u.test(ask) &&
    /\b(?:sem trava|destravado)\b/u.test(ask) &&
    /\b(?:saida|na frente)\b/u.test(ask) &&
    !/\b(?:tick|ticks|atraso|pulso|duracao|lateral)\b/u.test(ask) &&
    (ask.match(/\b\d+\b/gu)?.length ?? 0) === 1
  ) {
    const power = Number(signal[1]) > 0 ? 15 : 0;
    return rule(
      "MP-bedrock-repeater",
      `A saída frontal tem força ${power}. Um repetidor destravado em regime estável regenera qualquer entrada traseira positiva para 15. Com entrada 0, a saída é 0.`,
    );
  }

  if (
    has("MP-nether-water") &&
    /\bbalde de agua\b/u.test(ask) &&
    /\b(?:chao|terreno) do nether\b/u.test(ask) &&
    /\b(?:poca|bloco de agua|evapora|despejar|derramar)\b/u.test(ask) &&
    !/\b(?:caldeirao|gelo|comandos?|dispensador|trapa[çc]as|encher)\b/u.test(ask)
  ) {
    return rule(
      "MP-nether-water",
      "A água evapora ao ser despejada no chão do Nether. Nenhum bloco de água é colocado, então não se forma poça, nem temporária. Um caldeirão pode conter água, mas isso é outra interação.",
    );
  }

  return modelAnswer;
}
