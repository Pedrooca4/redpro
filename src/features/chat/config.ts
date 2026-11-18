export const MESSAGE_LIMIT = 4000;

export const EDITIONS = {
  JAVA: {
    label: "JavaMine",
    description: "Minecraft Java Edition",
    versions: ["1.21.1", "1.21", "1.20.4", "1.20.1"],
  },
  BEDROCK: {
    label: "BedMine",
    description: "Bedrock Edition (mobile, console e PCs compatíveis)",
    versions: ["1.21.0", "1.20.80", "1.20.0"],
  },
} as const;

export type Edition = keyof typeof EDITIONS;
export const MODES = [
  {
    id: "RED",
    title: "Redstone e engenharia",
    description: "Da primeira alavanca aos seus circuitos mais complexos.",
    question: "Meu pistão não estende. Como testo a alimentação?",
  },
  {
    id: "FARM",
    title: "Farms e automação",
    description: "Planeje recursos, condições de funcionamento e automação.",
    question: "Quero planejar uma farm de ferro compatível com minha edição.",
  },
  {
    id: "BUILDER",
    title: "Construção e arquitetura",
    description: "Dê forma às ideias com paletas, plantas e materiais.",
    question: "Planeje uma base 21×21 com uma lista estimada de materiais.",
  },
  {
    id: "COMMAND",
    title: "Comandos e datapacks",
    description: "Entenda a sintaxe e o contexto de cada comando.",
    question: "Como uso /help para conferir a sintaxe e as permissões?",
  },
  {
    id: "MODS",
    title: "Mods e add-ons",
    description: "Organize versões, dependências e evidências de erros.",
    question: "Meu jogo fecha ao iniciar com mods Fabric. Como investigo?",
  },
  {
    id: "SURVIVAL",
    title: "Sobrevivência e exploração",
    description: "Seu próximo passo na mineração, exploração e progressão.",
    question: "Quero minerar diamantes e uso picareta de pedra. Como me preparo?",
  },
] as const;
export type Mode = (typeof MODES)[number]["id"];
export type MinecraftContext = { edition: Edition; game_version: string | null; mode: Mode };

export const TOOLS = [
  {
    id: "crash",
    name: "Doutor de crash logs",
    mode: "MODS",
    description: "Organizar evidências, loader, dependências e possíveis conflitos.",
    limit: "Descreva o sintoma sem copiar nomes, caminhos pessoais, tokens ou logs privados.",
    question: "Quais informações devo remover de um crash report antes de pedir ajuda?",
  },
  {
    id: "conversion",
    name: "Java ↔ Bedrock",
    mode: "RED",
    description: "Revisar diferenças de mecânicas e alternativas entre edições.",
    limit: "Uma adaptação conceitual não garante um circuito equivalente ou testado.",
    question: "Quero revisar a compatibilidade de um circuito entre Java e Bedrock.",
  },
  {
    id: "materials",
    name: "Calculadora de materiais",
    mode: "BUILDER",
    href: "/ferramentas/materiais",
  },
  {
    id: "seeds",
    name: "Assistente de seeds",
    mode: "SURVIVAL",
    description: "Preparar uma busca por biomas e estruturas.",
    limit:
      "Não há coordenadas verificadas disponíveis para essa seed. A consulta real ainda não está conectada.",
    question: "Como verificar uma seed para minha edição e versão?",
  },
  {
    id: "enchant",
    name: "Otimizador de encantamentos",
    mode: "SURVIVAL",
    description: "Planejar combinações de livros, itens e trabalhos na bigorna.",
    limit:
      "O simulador ainda não está disponível. Custos dependem do histórico dos itens e das regras da versão.",
    question: "Quais dados dos meus itens preciso para planejar encantamentos na bigorna?",
  },
  {
    id: "mining",
    name: "Guia de mineração Y-Level",
    mode: "SURVIVAL",
    description: "Consultar distribuições de minérios por edição e versão.",
    limit:
      "O guia versionado ainda não está conectado. Nenhuma altura universal é recomendada aqui.",
    question: "Como conferir a distribuição de minérios para minha versão?",
  },
] as const satisfies readonly ({
  id: string;
  name: string;
  mode: Mode;
} & ({ href: string } | { description: string; limit: string; question: string }))[];

const alternativeQuestions: Record<Mode, string> = {
  RED: "Meu pistão não retrai. Como isolo a falha?",
  FARM: "Minha farm de ferro parou e nenhum golem aparece. Como verifico?",
  BUILDER: "Quantos blocos preciso para o piso de uma base 21 × 21?",
  COMMAND: "Como listar os comandos disponíveis no meu mundo?",
  MODS: "Um mod Fabric indica erro de dependência. Como verifico?",
  SURVIVAL: "Como minerar ferro com uma picareta de pedra?",
};

export function suggestionsFor(context: MinecraftContext): string[] {
  const edition = EDITIONS[context.edition].label;
  const version = context.game_version
    ? `versão ${context.game_version}`
    : "versão ainda não informada";
  const mode = MODES.find((entry) => entry.id === context.mode)!;
  const bedrockMods = context.mode === "MODS" && context.edition === "BEDROCK";
  const primary = bedrockMods ? "Um add-on de mundo não ativa. Como investigo?" : mode.question;
  const secondary = bedrockMods
    ? "Como diagnosticar conflito entre pacotes de comportamento?"
    : alternativeQuestions[context.mode];
  return [`${primary} Uso ${edition}, ${version}.`, secondary];
}

// Reference choices are examples, never a claim about the latest Minecraft release.
export function isGameVersion(value: string): boolean {
  return /^\d{1,2}\.\d{1,2}(?:\.\d{1,3})?$/.test(value);
}
