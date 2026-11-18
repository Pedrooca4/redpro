import type { DetailField, ProcedureId } from "./contracts.ts";

export function normalizeQuestion(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const piston = /\bpist(?:ao|oes)\b/;
const ironFarm = /\b(?:farm|fazenda|gerador)\s+de\s+ferro\b/;
const base21 = /\b21\s*(?:x|×|por)\s*21\b/;
const addons = /\b(?:add[- ]?ons?|pacotes? de comportamento|pacotes? de recursos)\b/;
const mods =
  /\b(?:mods?|modpacks?|add[- ]?ons?|crash reports?|fabric(?: loader)?|pacotes? de comportamento|pacotes? de recursos)\b/;
const help = /(?:^|\W)\/help\b/;
const mining = /\b(?:minera\w*|escavar|extrair|coletar|buscar|busca por|conseguir|obter)\b/;
const resource = /\b(?:carvao|ferro|diamantes?|minerios?)\b/;
const toolMaterial = "(?:madeira|pedra|ouro|ferro|diamante|netherite)\\b";
const toolMaterials = `${toolMaterial}(?: (?:ou|e) (?:de )?${toolMaterial})*`;
const toolMatch = new RegExp(`\\bpicaretas? (?:de )?${toolMaterials}`, "g");
const toolStatement = new RegExp(
  `\\b(?:(?<denial>nao (?:tenho|uso|possuo)(?: mais)?|sem|nem) |(?<affirmation>tenho|uso|possuo|com) )?(?:(?:uma|a|minha|nenhuma) )?picaretas?\\b(?: (?:de )?(?<materials>${toolMaterials}))?`,
  "g",
);
const shortTool = new RegExp(
  `^(?:eu )?(?:(nao )?(?:tenho|uso|possuo) )?(?:uma )?(?:picareta )?(?:de )?(${toolMaterials})[.!?]?$`,
);

const intentRules: Record<ProcedureId, (text: string) => boolean> = {
  "red-piston": (text) =>
    piston.test(text) &&
    /\b(?:funcion\w*|comport\w*|diagnostic\w*|test\w*|trav\w*|estend\w*|retrai\w*|empurr\w*|falh\w*|sem movimento)\b/.test(
      text,
    ) &&
    !/\b(?:carro|motor automotivo|moto)\b/.test(text),
  "farm-iron": (text) =>
    ironFarm.test(text) &&
    (/^(?:farm|fazenda|gerador) de ferro[?.!]*$/.test(text) ||
      /\b(?:planej\w*|mont\w*|constru\w*|test\w*|verific\w*|diagnostic\w*|funcion\w*|parou|produ\w*|gole\w*|fazer|faco|conferir)\b/.test(
        text,
      )),
  "builder-base-21": (text) =>
    /\bbase\b/.test(text) &&
    base21.test(text) &&
    !/\b(?!21\s*(?:x|×|por)\s*21\b)\d+\s*(?:x|×|por)\s*\d+\b/.test(text) &&
    /\b(?:planej\w*|constru\w*|mont\w*|calcul\w*|materia(?:l|is)|blocos|fazer|faco)\b/.test(text),
  "command-help": (text) =>
    help.test(text) ||
    (/\bcomandos?\b/.test(text) &&
      /\b(?:sintaxe|permiss\w*|list\w*|ajuda|disponive\w*)\b/.test(text)),
  "mods-triage": (text) =>
    mods.test(text) &&
    /\b(?:conflit\w*|incompat\w*|compatibil\w*|dependenc\w*|erro|falh\w*|crash\w*|fecha\w*|nao (?:carrega|ativa|abre))\b/.test(
      text,
    ),
  "survival-mining": (text) => mining.test(text) && resource.test(text.replace(toolMatch, "")),
};

export function findIntents(text: string): ProcedureId[] {
  if (
    /^(?:escreva|crie|invente|traduza|faca)\s+(?:(?:um|uma|o|a)\s+)?(?:poema|piada|conto|historia|traducao)\b/.test(
      text,
    )
  )
    return [];
  return (Object.keys(intentRules) as ProcedureId[]).filter((id) => intentRules[id](text));
}

const options: Record<Exclude<DetailField, "pickaxe">, readonly [string, RegExp][]> = {
  piston: [
    [
      "not-extending",
      /\b(?:nao (?:se )?(?:estende|empurra|abre|aciona)|sem movimento|fica retraido)\b/,
    ],
    ["not-retracting", /\b(?:nao (?:se )?(?:retrai|recolhe|fecha|volta)|fica estendido)\b/],
    ["blocked", /\b(?:bloqueado|travado|tem um bloco|com carga|obstrucao)\b/],
  ],
  farm: [
    [
      "no-golem",
      /\b(?:nao (?:aparece|nasce|gera|surge)(?: (?:nenhum|um))? (?:golem|golems)|sem golens?|nenhum golem)\b/,
    ],
    ["no-item", /\b(?:sem ferro|nao (?:recolhe|coleta|cai) ferro|bau vazio|sem itens)\b/],
  ],
  command: [
    [
      "help",
      /(?:^|\W)\/help\b|\b(?:listar comandos|lista de comandos|sintaxe|comandos disponiveis)\b/,
    ],
  ],
  setup: [
    ["fabric", /\bfabric\b/],
    ["bedrock-addons", addons],
  ],
  issue: [
    ["crash", /\b(?:crash\w*|fecha|fechamento|trava|travamento)\b/],
    ["dependency", /\bdependenc\w*\b/],
    ["version", /\b(?:versao incompativel|versoes incompativeis|incompatibilidade de versao)\b/],
    ["activation", /\b(?:ativacao|nao (?:ativa|aparece|carrega))\b/],
  ],
  resource: [
    ["coal", /\bcarvao\b/],
    ["iron", /\bferro\b/],
    ["diamond", /\bdiamantes?\b/],
  ],
};

const pickaxeNames: Record<string, string> = {
  madeira: "wood",
  pedra: "stone",
  ouro: "gold",
  ferro: "iron",
  diamante: "diamond",
  netherite: "netherite",
};

function pickaxe(text: string, shortReply: boolean): string | null | undefined {
  if (shortReply) {
    if (
      /^(?:(?:eu )?nao (?:tenho|possuo)(?: (?:uma )?picareta)?|sem picareta|nenhuma|nenhum)[.!]?$/.test(
        text,
      )
    )
      return "none";
    const short = shortTool.exec(text);
    if (short) return short[1] ? null : (pickaxeNames[short[2]] ?? null);
    const remainingText = text.replace(toolStatement, "");
    if (
      !/^(?:(?:eu|e|ou|mas|porem|na verdade|quer dizer|corrigindo)\b|[ .!,;?])*$/.test(
        remainingText,
      )
    )
      return undefined;
  }

  const latest = text.split(/\b(?:na verdade|quer dizer|corrigindo)\b/).at(-1) ?? text;
  const claims = [...latest.matchAll(toolStatement)];
  if (!claims.length) return undefined;

  const available = new Set<string>();
  const denied = new Set<string>();
  const hasDenial = claims.some(({ groups }) => groups?.denial);
  for (const claim of claims) {
    const { denial, affirmation, materials } = claim.groups!;
    if (!materials) {
      const tail = latest.slice(claim.index + claim[0].length);
      if (denial && /^(?:$|[.,!?;]| (?:e|mas|porem|nenhuma|nenhum)\b)/.test(tail))
        available.add("none");
      continue;
    }
    // In a denial, an unqualified second tool can still be part of the denied list.
    if (!denial && !affirmation && hasDenial) continue;
    const target = denial ? denied : available;
    for (const material of materials.split(/ (?:ou|e) (?:de )?/)) target.add(material);
  }
  const [material] = available;
  if (available.size !== 1 || denied.has(material)) return null;
  return material === "none" ? material : pickaxeNames[material];
}

// Null means the message addresses this field without confirming a value.
export function readDetail(
  field: DetailField,
  text: string,
  shortReply = false,
): string | null | undefined {
  if (field === "pickaxe") return pickaxe(text, shortReply);
  if (
    shortReply &&
    field === "resource" &&
    !/^(?:(?:quero|prefiro) )?(?:o |os )?(?:carvao|ferro|diamantes?)(?: primeiro)?[.!]?$/.test(text)
  )
    return undefined;
  const content = field === "resource" ? text.replace(toolMatch, "") : text;
  const matches = options[field].filter(([, pattern]) => pattern.test(content));
  return matches.length === 1 ? matches[0][0] : undefined;
}
