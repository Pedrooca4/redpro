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
    question: "Por que meu pistão se comporta de forma diferente entre edições?",
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
    question: "Explique um comando para minha edição e suas permissões.",
  },
  {
    id: "MODS",
    title: "Mods e add-ons",
    description: "Organize versões, dependências e evidências de erros.",
    question: "Como identificar um conflito entre mods no meu crash report?",
  },
  {
    id: "SURVIVAL",
    title: "Sobrevivência e exploração",
    description: "Seu próximo passo na mineração, exploração e progressão.",
    question: "Como planejar minha busca por diamantes nesta versão?",
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
    limit:
      "Antes de enviar, remova nomes, caminhos pessoais e tokens do relatório. Não cole logs privados neste protótipo.",
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
    description: "Planejar quantidades, stacks, combustível e desgaste.",
    limit:
      "O cálculo real ainda não está disponível. Dimensões e limites de empilhamento serão necessários.",
    question: "Quais medidas e materiais preciso reunir para calcular minha construção?",
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
] as const satisfies readonly {
  id: string;
  name: string;
  mode: Mode;
  description: string;
  limit: string;
  question: string;
}[];

export function suggestionsFor(context: MinecraftContext): string[] {
  const edition = EDITIONS[context.edition].label;
  const version = context.game_version
    ? `versão ${context.game_version}`
    : "versão ainda não informada";
  const mode = MODES.find((entry) => entry.id === context.mode)!;
  return [
    `${mode.question} Uso ${edition}, ${version}.`,
    context.mode === "MODS" && context.edition === "BEDROCK"
      ? "Como organizar a compatibilidade dos meus add-ons Bedrock?"
      : `Quais informações preciso reunir para começar com ${mode.title.toLowerCase()} em ${edition}?`,
  ];
}

// Reference choices are examples, never a claim about the latest Minecraft release.
export function isGameVersion(value: string): boolean {
  return /^\d{1,2}\.\d{1,2}(?:\.\d{1,3})?$/.test(value);
}
