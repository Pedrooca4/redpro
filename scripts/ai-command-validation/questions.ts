import { type CommandContext, type CommandResult, validateIntent } from "./validate.ts";

const weatherStates = [
  [
    "clear",
    /^(?:limp(?:ar|a|e) (?:o )?(?:clima|ceu)|(?:parar|pare|tirar|remover|acabar com) (?:a )?chuva|(?:deixar|deixe) (?:o )?(?:ceu|clima) limpo|ceu limpo|clima limpo|\/weather clear)$/u,
  ],
  ["rain", /^(?:fazer chover|colocar chuva|ativar (?:a )?chuva|\/weather rain)$/u],
  ["thunder", /^(?:iniciar (?:uma )?tempestade|ativar (?:uma )?tempestade|\/weather thunder)$/u],
  ["query", /^(?:consultar (?:o )?clima|ver (?:o )?clima atual|\/weather query)$/u],
] as const;
const timePreservation =
  /\b(?:sem|nao quero|nao pode|nao deve)\s+(?:mudar|alterar|mexer n[oa]|resetar)\s*(?:a |o )?(?:horario|hora|relogio|ciclo do dia)\b|\b(?:preservando|mantendo|preserve|mantenha|manter) (?:o )?(?:horario|relogio)\b/gu;
const fillRequest =
  /^(?:(?:eu )?quero |como posso |como |preciso |me ajude a )?(?:preencher\b|preenche\b|preencha\b|usar \/fill(?=\s|[?.!;]|$))/u;
const fillSlots =
  /\b(primeiro canto|segundo canto|canto inicial|canto final|bloco(?: de destino)?|modo)\s*[:=]\s*([^;?!\n]+)/gu;
const compound =
  /\b(?:depois|em seguida|tambem|ou|alem de|se|compare|comparar|execute|automat\w*|repetir|comando de bloco|plugin|mod|addon|servidores?)\b/u;
const materials = new Map([
  ["vidro", "glass"],
  ["pedra", "stone"],
  ["pedregulho", "cobblestone"],
  ["terra", "dirt"],
  ["tabuas de carvalho", "oak_planks"],
  ["ar", "air"],
]);

function outside(reason: string): CommandResult {
  return { status: "outside-scope", reason };
}

function parsePoint(value: string) {
  return value
    .trim()
    .replace(/^\((.*)\)$/u, "$1")
    .split(/\s*,\s*|\s+/u);
}

function fillQuestion(context: CommandContext, text: string): CommandResult {
  if (!fillRequest.test(text))
    return outside("Pedido de preenchimento fora dos formatos de desenvolvimento.");
  const fields = new Map<string, string>();
  for (const [, label, value] of text.matchAll(fillSlots)) {
    const key = /primeiro|inicial/u.test(label)
      ? "from"
      : /segundo|final/u.test(label)
        ? "to"
        : label === "modo"
          ? "mode"
          : "block";
    if (fields.has(key)) return outside("Há mais de um valor para o mesmo campo.");
    fields.set(key, value.trim().replace(/\.$/u, ""));
  }
  const plain = text.replace(fillSlots, "");
  const preserve =
    /\b(?:e\s+)?(?:preservar|preservando|manter|mantendo) (?:os )?blocos existentes\b|\bsem (?:substituir|apagar|destruir|quebrar|alterar) (?:os )?blocos existentes\b/u;
  const preserveExisting = preserve.test(plain);
  const remainder = plain.replace(preserve, "").replace(fillRequest, "").trim();
  const request =
    /^(?:(?:(?:a |o |uma |um )?(?:sala|regiao|area|volume|espaco))\b\s*)?(?:com \/fill\b\s*)?(?:com ([a-z_:]+(?: de carvalho)?))?\s*(?:[;.!?\s]*)(?:me d[aê] o comando pronto[.!?\s]*)?(?:(?:ainda )?nao medi(?: nada)?[.!?\s]*)?$/u.exec(
      remainder,
    );
  if (!request)
    return outside("Operação, condição ou coordenadas em prosa fora dos formatos reconhecidos.");
  if (request[1]) {
    if (fields.has("block")) return outside("Há mais de um valor para o bloco.");
    fields.set("block", materials.get(request[1]) ?? request[1]);
  }
  const from = fields.get("from");
  const to = fields.get("to");
  const block = fields.get("block");
  return validateIntent(context, {
    command: "fill",
    from: from === undefined ? undefined : parsePoint(from),
    to: to === undefined ? undefined : parsePoint(to),
    block: block === undefined ? undefined : (materials.get(block) ?? block),
    mode: fields.get("mode"),
    preserveExisting,
  });
}

export function resolveQuestion(context: CommandContext, question: string): CommandResult {
  const text = question
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\t ]+/gu, " ");
  const mentions = [...text.matchAll(/\/[a-z][a-z0-9_-]*/gu)].map((match) => match[0]);
  if (
    compound.test(text) ||
    new Set(mentions).size > 1 ||
    mentions.some((name) => name !== "/fill" && name !== "/weather")
  ) {
    return outside("Pedido composto, condicional ou com outro comando.");
  }
  const editions = new Set([...text.matchAll(/\b(java|bedrock)\b/gu)].map((match) => match[0]));
  const mentionedEdition = editions.has("java")
    ? "Java"
    : editions.has("bedrock")
      ? "Bedrock"
      : null;
  if (
    editions.size > 1 ||
    (mentionedEdition && context.edition && mentionedEdition !== context.edition)
  ) {
    return outside("Edição no texto não coincide com o contexto estruturado.");
  }
  const versions = new Set([...text.matchAll(/\b\d+\.\d+\.\d+\b/gu)].map((match) => match[0]));
  const mentionedVersion = [...versions][0];
  if (
    versions.size > 1 ||
    (mentionedVersion && context.version && mentionedVersion !== context.version)
  ) {
    return outside("Versão no texto não coincide com o contexto estruturado.");
  }
  const effective = {
    edition: context.edition ?? mentionedEdition,
    version: context.version ?? mentionedVersion,
  };
  const version = effective.version?.match(/^\d+\.\d+\.\d+$/u)?.[0];
  const edition = mentionedEdition?.toLowerCase();
  const request = edition
    ? text
        .replace(
          new RegExp(
            `(?:^|\\s)(?:no |na |em )?${edition}${version ? `(?: ${version.replaceAll(".", "\\.")})?` : ""}(?:[:,]\\s*|\\s+|(?=[?.!]|$))`,
            "gu",
          ),
          " ",
        )
        .trim()
    : text;
  if (mentions.includes("/fill") || fillRequest.test(request))
    return fillQuestion(effective, request);

  const weather = request
    .replace(timePreservation, "")
    .replace(/[.,?!;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(
      /^(?:qual (?:e o )?comando (?:para )?|como (?:eu )?(?:posso )?|(?:eu )?quero |preciso |gostaria de )/u,
      "",
    )
    .replace(/\s+(?:agora|por favor)$/u, "");
  const match = weatherStates.find(([, pattern]) => pattern.test(weather));
  if (match) return validateIntent(effective, { command: "weather", state: match[0] });
  if (/^(?:mudar|alterar) (?:o )?clima$/u.test(weather))
    return validateIntent(effective, { command: "weather" });
  return outside("Intenção fora dos formatos de desenvolvimento.");
}
