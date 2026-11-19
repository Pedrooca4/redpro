import { EDITIONS, type MinecraftContext } from "../chat/config.ts";
import { catalog, procedureCompatibility } from "./catalog.ts";
import {
  procedureFields,
  type AssistantReply,
  type AssistantRequest,
  type DetailField,
  type Details,
  type ProcedureId,
} from "./contracts.ts";
import { findIntents, normalizeQuestion, readDetail } from "./intent.ts";

const prompts: Record<DetailField, string> = {
  piston:
    "O que acontece ao acionar seu pistão? Diga se não estende, não retrai ou se fica bloqueado pela carga.",
  farm: "Qual etapa está falhando? Responda se nenhum golem aparece ou se há golems mas o coletor fica sem ferro.",
  command:
    "Qual é seu objetivo com o comando? Para listar os comandos disponíveis ou verificar a sintaxe no jogo, responda /help.",
  setup:
    "Qual é a plataforma envolvida? Informe se usa Fabric no Java ou add-ons aplicados a um mundo Bedrock.",
  issue:
    "Qual frase descreve a falha? Informe se o jogo fecha, falta uma dependência, há versão incompatível ou o pacote não ativa. Evite colar logs, caminhos ou dados privados.",
  resource: "Qual minério quer obter primeiro? Escolha carvão, ferro ou diamante.",
  pickaxe:
    "Que picareta você tem hoje? Responda madeira, pedra, ouro, ferro, diamante, netherite ou nenhuma.",
};

function missingDetail(id: ProcedureId, details: Details, text: string): DetailField | undefined {
  if (id === "farm-iron") {
    const diagnosing =
      /\b(?:nao (?:funciona|produz|nasce|aparece|coleta)|parou|falha|diagnostic\w*|problema)\b/.test(
        text,
      );
    return diagnosing && !details.farm ? "farm" : undefined;
  }
  return procedureFields(id).find((field) => !details[field]);
}

const editionName = "javamine|bedmine|java|bedrock";
const versionNumber = "\\d{1,2}\\.\\d{1,2}(?:\\.\\d{1,3})?\\b(?!\\.\\d)";
const versionLabel = "(?:(?:a |na )?versao(?: do (?:jogo|minecraft))?[ :]+)?";
const comparisonJoin =
  "\\s*(?:(?:[,;?!]\\s*)?\\b(?:e|ou|x|vs|versus|para|contra)\\b\\.?|[,/×])\\s*";
const comparedVersion = `${comparisonJoin}${versionLabel}${versionNumber}`;

// A bare edition name can describe a tutorial, a mod, or a building material.
const declaredEditions = new RegExp(
  `\\b(?:(?:minecraft|(?:uso|jogo|em|no|na|para|entre)(?: [oa])?)(?: edicao)? (${editionName})\\b|(${editionName})\\b(?=(?: edition)?[ ,:]+${versionLabel}${versionNumber}))`,
  "g",
);
const comparedEditions = new RegExp(
  `\\b(${editionName})\\b(?: edition)?(?: ${versionNumber})?${comparisonJoin}(?:(?:em|no|na|[oa]|minecraft|edicao) ){0,3}(${editionName})\\b`,
  "g",
);
const declaredVersions = new RegExp(
  `\\b(?:minecraft|versao do (?:jogo|minecraft)|(?:${editionName})(?: edition)?)[ ,:]+${versionLabel}(${versionNumber}(?:${comparedVersion})*)`,
  "g",
);
const versionComparisons = new RegExp(
  `\\b(?:vers(?:ao|oes)|entre)[ :]+(${versionNumber}(?:${comparedVersion})+)`,
  "g",
);
const versionValues = new RegExp(versionNumber, "g");

export function contextConflict(
  text: string,
  context: MinecraftContext,
): "ambiguous" | "mismatch" | undefined {
  const editions = new Set(
    [...text.matchAll(declaredEditions), ...text.matchAll(comparedEditions)]
      .flatMap((match) => match.slice(1).filter(Boolean))
      .map((name) => (name.startsWith("java") ? "JAVA" : "BEDROCK")),
  );
  const versions = new Set(
    [...text.matchAll(declaredVersions), ...text.matchAll(versionComparisons)].flatMap(
      ([, values]) => values.match(versionValues) ?? [],
    ),
  );
  if (editions.size > 1 || versions.size > 1) return "ambiguous";
  if (
    (editions.size > 0 && !editions.has(context.edition)) ||
    (versions.size > 0 && context.game_version !== null && !versions.has(context.game_version))
  )
    return "mismatch";
}

export function guide({ message, context, followUp }: AssistantRequest): AssistantReply {
  const text = normalizeQuestion(message);
  const intents = findIntents(text);
  if (intents.length > 1) {
    const topics = intents
      .toSorted(
        (a, b) =>
          Number(catalog[b].mode === context.mode) - Number(catalog[a].mode === context.mode),
      )
      .map((id) => catalog[id].topic);
    return {
      type: "CLARIFICATION",
      context,
      text: `Há mais de um assunto no pedido. Qual você quer tratar primeiro? Envie só um destes pedidos: ${topics.join(" ou ")}.`,
    };
  }

  const answeredDetail = followUp && readDetail(followUp.field, text, !intents.length);
  const id = intents[0] ?? (answeredDetail !== undefined ? followUp?.procedureId : undefined);
  if (!id) {
    const topic = Object.values(catalog).find(
      (procedure) => procedure.mode === context.mode,
    )?.topic;
    return {
      type: "UNSUPPORTED",
      context,
      text: `Ainda não há orientação validada para esse pedido. No modo selecionado, o catálogo cobre ${topic}. Descreva o objetivo e o que observou no jogo.`,
    };
  }
  const conflict = contextConflict(text, context);
  if (conflict) {
    return {
      type: "CLARIFICATION",
      context,
      text:
        conflict === "ambiguous"
          ? "A pergunta cita mais de uma edição ou versão. Qual contexto quer usar? Ajuste os seletores e reenvie a pergunta com uma única edição e versão."
          : "A edição ou a versão citada difere da seleção. Qual contexto quer usar? Ajuste os seletores e envie a pergunta novamente.",
    };
  }

  const procedure = catalog[id];
  const versions = procedure.versions[context.edition];
  const editionLabel = EDITIONS[context.edition].label;
  if (context.game_version === null) {
    return {
      type: "CLARIFICATION",
      context,
      needsVersion: true,
      text: `Qual versão do Minecraft você usa? Selecione no chat e reenvie a pergunta. Para ${editionLabel}, o catálogo deste procedimento cobre ${versions.join(", ")}.`,
    };
  }
  if (!versions.includes(context.game_version)) {
    return {
      type: "UNSUPPORTED",
      context,
      text: `O procedimento de ${procedure.topic} foi preparado para ${editionLabel} ${versions.join(", ")}. Para a versão selecionada, ainda não há orientação validada.`,
    };
  }

  const details = { ...(followUp?.procedureId === id ? followUp.details : {}) };
  for (const field of procedureFields(id)) {
    if (
      followUp?.procedureId === id &&
      followUp.field === "pickaxe" &&
      field === "resource" &&
      !intents.length
    )
      continue;
    const detail =
      followUp?.procedureId === id && followUp.field === field && answeredDetail !== undefined
        ? answeredDetail
        : readDetail(field, text);
    if (detail === null) delete details[field];
    else if (detail) details[field] = detail;
  }
  if (
    id === "mods-triage" &&
    ((context.edition === "JAVA" &&
      (details.setup === "bedrock-addons" || /\b(?:forge|neoforge|quilt)\b/.test(text))) ||
      (context.edition === "BEDROCK" && details.setup === "fabric"))
  ) {
    return {
      type: "UNSUPPORTED",
      context,
      text: "A triagem validada cobre Fabric no Java e pacotes de mundo no Bedrock. Confira a edição e a plataforma instaladas antes de aplicar o procedimento.",
    };
  }
  const field = missingDetail(id, details, text);
  if (field) {
    return {
      type: "CLARIFICATION",
      context,
      text: prompts[field],
      followUp: { procedureId: id, field, details },
    };
  }

  const validatedContext = { ...context, game_version: context.game_version };
  const { answer, sources } = procedure.build(validatedContext, details);
  return {
    type: "ANSWER",
    context: validatedContext,
    procedureId: id,
    answer: {
      ...answer,
      compatibility: [procedureCompatibility(validatedContext), answer.compatibility]
        .filter(Boolean)
        .join(" "),
    },
    verification: procedure.verification,
    sources,
  };
}
