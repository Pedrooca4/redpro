import type { MinecraftContext, Mode } from "../../chat/config.ts";
import { estimateBlocks } from "../../materials/calculations.ts";
import { builderBaseDimensions, catalog, supportedVersions } from "../catalog.ts";
import { isAssistantReply, sameContext, type Answer, type FollowUp } from "../contracts.ts";
import { contextConflict, guide } from "../guide.ts";
import { findIntents, normalizeQuestion } from "../intent.ts";
import {
  failure,
  unavailable,
  type Calculation,
  type ConversationInput,
  type ConversationResult,
  type Route,
  type Verified,
} from "./contracts.ts";

type Decision =
  { route: "MODEL"; focus: Mode } | { route: Exclude<Route, "MODEL">; result: ConversationResult };

// Requests for execution, private data or exact mechanics outside the catalog need evidence.
const evidenceRequired =
  /\b(?:seed(?:s)?|coordenadas?|altura y|y-level|por hora|taxa de producao|logs? privad\w*|senhas?|tokens?|chaves? (?:da api|de acesso))\b|\b(?:execute|rode|ative)\b.{0,35}\b(?:comando|servidor|ferramenta)\b|\/(?!help\b)[a-z][a-z0-9_-]*\b/;

const verificationRequired =
  /\b(?:quantidade exata|equivalencia garantida|resultado comprovado|fonte oficial consultada)\b/;

const subjects: Record<Mode, RegExp> = {
  RED: /\b(?:redstone|sinal|circuito|alavancas?|repetidor(?:es)?|lampadas?)\b/,
  FARM: /\b(?:farm\w*|plantacao|colheita|funis|golem|coletor)\b/,
  BUILDER: /\b(?:base|blocos|parede|fachada|telhado|paleta|construcao|materiais)\b/,
  COMMAND: /\b(?:comandos?|permiss\w*|datapacks?|bloco de comando)\b/,
  MODS: /\b(?:mods?|add[- ]?ons?|loader|pacotes?|fabric|dependencias?)\b/,
  SURVIVAL: /\b(?:miner\w*|picareta|caverna|explor\w*|diamantes?|sobreviv\w*|abrigo|inventario)\b/,
};
const assistance =
  /\b(?:como|qual|quais|por que|posso|quero|preciso|ajude|explique|sugira|vale|e se)\b/;

function verified(reply: Answer): Verified | null {
  const procedure = catalog[reply.procedureId];
  const { context, answer, procedureId, sources } = reply;
  if (
    !procedure.versions[context.edition].includes(context.game_version) ||
    procedure.verification !== reply.verification
  )
    return null;
  const common = {
    type: "VERIFIED",
    origin: "DETERMINISTIC",
    text: answer.text,
    procedureId,
    answer,
    sources,
    limitations: answer.warnings ?? [],
  } as const;
  if (reply.verification === "DOCUMENTED") return { ...common, evidence: { kind: "DOCUMENTED" } };
  if (procedureId !== "builder-base-21") return null;

  const { length, width, wallHeight } = builderBaseDimensions;
  const floor = estimateBlocks("platform", { length, width });
  const walls = estimateBlocks("walls", { length, width, height: wallHeight });
  const [floorMaterial, wallMaterial] = answer.materials ?? [];
  if (
    floorMaterial?.quantity !== floor ||
    floorMaterial.estimated ||
    wallMaterial?.quantity !== walls ||
    !wallMaterial.estimated
  )
    return null;
  const calculations: Calculation[] = [
    {
      ruleId: "estimateBlocks:platform",
      inputs: { length, width, height: 1 },
      formula: `${length} × ${width} = ${floor}`,
      assumptions: ["Uma camada preenchida, sem descontar aberturas."],
      result: floor,
      unit: "blocos",
      estimated: false,
    },
    {
      ruleId: "estimateBlocks:walls",
      inputs: { length, width, height: wallHeight },
      formula: `(2 × ${length} + 2 × ${width} − 4) × ${wallHeight} = ${walls}`,
      assumptions: ["Perímetro retangular, com cantos contados uma vez e sem aberturas."],
      result: walls,
      unit: "blocos",
      estimated: true,
    },
  ];
  return { ...common, evidence: { kind: "CALCULATED", calculations } };
}

function declaredGameVersionMismatch(text: string, context: MinecraftContext): boolean {
  const mentions = [
    ...text.matchAll(
      /\b(?:na versao|jogo (?:na )?versao) (\d{1,2}\.\d{1,2}(?:\.\d{1,3})?)\b(?!\.\d| (?:do|da|de) (?!minecraft\b|jogo\b))/g,
    ),
  ].map((value) => value[1]);
  return (
    new Set(mentions).size > 1 ||
    (context.game_version !== null && mentions.some((version) => version !== context.game_version))
  );
}

export function routeConversation(input: ConversationInput, followUp?: FollowUp): Decision {
  const { message, context } = input;
  const text = normalizeQuestion(message);
  if (contextConflict(text, context) || declaredGameVersionMismatch(text, context))
    return {
      route: "CLARIFICATION",
      result: {
        type: "CLARIFICATION",
        origin: "SYSTEM",
        text: "Qual edição e versão devemos considerar? A pergunta e o contexto selecionado precisam indicar uma combinação única.",
      },
    };
  if (context.game_version === null)
    return {
      route: "CLARIFICATION",
      result: {
        type: "CLARIFICATION",
        origin: "SYSTEM",
        needsVersion: true,
        text: "Qual versão do Minecraft você usa nesta edição?",
      },
    };
  const versions: readonly string[] = supportedVersions[context.edition];
  if (!versions.includes(context.game_version) || evidenceRequired.test(text))
    return { route: "UNAVAILABLE", result: unavailable("EVIDENCE_INSUFFICIENT") };

  const reply = guide({ message, context, followUp });
  if (!isAssistantReply(reply) || !sameContext(reply.context, context))
    return { route: "UNAVAILABLE", result: failure("INTERNAL_ERROR") };
  if (reply.type === "ANSWER") {
    const result = verified(reply);
    return result
      ? { route: "DETERMINISTIC", result }
      : { route: "UNAVAILABLE", result: failure("INTERNAL_ERROR") };
  }
  if (reply.type === "CLARIFICATION") {
    const { text: question, followUp, needsVersion } = reply;
    return {
      route: "CLARIFICATION",
      result: {
        type: "CLARIFICATION",
        origin: "DETERMINISTIC",
        text: question,
        followUp,
        needsVersion,
      },
    };
  }

  const matchingModes = (Object.keys(subjects) as Mode[]).filter((mode) =>
    subjects[mode].test(text),
  );
  const focus = matchingModes.includes(context.mode) ? context.mode : matchingModes[0];
  if (
    !focus ||
    !assistance.test(text) ||
    verificationRequired.test(text) ||
    findIntents(text).length
  )
    return { route: "UNAVAILABLE", result: unavailable("EVIDENCE_INSUFFICIENT") };
  return { route: "MODEL", focus };
}
