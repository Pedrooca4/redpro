import { EDITIONS, type Edition, type MinecraftContext, type Mode } from "../chat/config.ts";
import { estimateBlocks } from "../materials/calculations.ts";
import type {
  Answer,
  Details,
  Evidence,
  ProcedureId,
  StructuredAnswerContent,
} from "./contracts.ts";

export const supportedVersions = { JAVA: ["1.21.1"], BEDROCK: ["1.21.0"] } as const;

export const builderBaseDimensions = { length: 21, width: 21, wallHeight: 3 } as const;

type Procedure = {
  mode: Mode;
  topic: string;
  versions: Readonly<Record<Edition, readonly string[]>>;
  verification: Answer["verification"];
  build: (
    context: Answer["context"],
    details: Details,
  ) => { answer: StructuredAnswerContent; sources: readonly Evidence[] };
};

const golemSource = {
  title: "Minecraft Wiki · Geração de golens por edição",
  url: "https://minecraft.wiki/w/Iron_Golem#Spawning",
};
const pickaxeSources: Record<
  string,
  { label: string; minimum: string; levels: readonly string[]; source: Evidence }
> = {
  coal: {
    label: "carvão",
    minimum: "madeira",
    levels: ["wood", "stone", "gold", "iron", "diamond", "netherite"],
    source: {
      title: "Minecraft Wiki · Minério de carvão",
      url: "https://minecraft.wiki/w/Coal_Ore#Obtaining",
    },
  },
  iron: {
    label: "ferro",
    minimum: "pedra",
    levels: ["stone", "iron", "diamond", "netherite"],
    source: {
      title: "Minecraft Wiki · Minério de ferro",
      url: "https://minecraft.wiki/w/Iron_Ore#Obtaining",
    },
  },
  diamond: {
    label: "diamante",
    minimum: "ferro",
    levels: ["iron", "diamond", "netherite"],
    source: {
      title: "Minecraft Wiki · Minério de diamante",
      url: "https://minecraft.wiki/w/Diamond_Ore#Obtaining",
    },
  },
};

export const catalog: Record<ProcedureId, Procedure> = {
  "red-piston": {
    mode: "RED",
    topic: "diagnóstico de pistões",
    versions: supportedVersions,
    verification: "DOCUMENTED",
    build: ({ edition }, details) => ({
      answer: {
        text: "Isole o pistão da montagem para descobrir se a falha vem da alimentação, do espaço de movimento ou do circuito original.",
        prerequisites: [
          "Separe um pistão comum, um bloco de redstone e um bloco de terra para a bancada de teste.",
          "Use uma área em que seja seguro energizar a montagem.",
        ],
        steps: [
          "Oriente o pistão para um espaço livre. Coloque um bloco de redstone ao lado ou atrás dele e retire a fonte em seguida.",
          "Se a primeira verificação funcionar, coloque um bloco de terra à frente do pistão e mantenha livre o espaço seguinte. Repita o acionamento.",
          details.piston === "not-retracting"
            ? "Na montagem original, desligue a alimentação e verifique se restou outra fonte de sinal. Em um pistão comum, a terra empurrada fica no lugar ao retrair."
            : "Na montagem original, confira se o sinal chega à face esperada e se a carga tem espaço para se mover. Reintroduza um componente por vez.",
        ],
        compatibility:
          edition === "JAVA"
            ? "No Java, um pistão também pode receber alimentação por quase-conectividade. Se o circuito original usa alimentação acima, compare com o teste de alimentação direta."
            : "No Bedrock, faça o teste com alimentação por uma face lateral ou traseira. Ao copiar um circuito Java, confira cada ponto de alimentação nesta edição.",
        verification:
          "No teste isolado, a cabeça estende com alimentação direta e retrai quando a fonte é retirada. Se isso funcionar, reteste a montagem original mudando uma condição por vez.",
        warnings: [
          "O teste localiza uma diferença de comportamento. A causa exata e a equivalência entre circuitos dependem da montagem observada.",
        ],
      },
      sources: [
        {
          title: "Minecraft Wiki · Alimentação e movimento de pistões",
          url: "https://minecraft.wiki/w/Piston#Redstone_component",
        },
        {
          title: "Minecraft Wiki · Bloco de redstone",
          url: "https://minecraft.wiki/w/Block_of_Redstone#Redstone_component",
        },
      ],
    }),
  },
  "farm-iron": {
    mode: "FARM",
    topic: "planejamento e inspeção de farm de ferro",
    versions: supportedVersions,
    verification: "DOCUMENTED",
    build: ({ edition }, details) => ({
      answer: {
        text: "Separe a farm em geração de golens, transporte e coleta. Confira cada parte antes de alterar o projeto inteiro.",
        prerequisites: [
          "Prepare aldeões, camas, uma superfície adequada para geração e um ponto de coleta conforme o projeto da sua edição.",
          edition === "JAVA"
            ? "Os aldeões precisam ter dormido recentemente e o grupo precisa cumprir as condições de convocação da edição Java."
            : "Os aldeões precisam vincular-se às camas. Confira também se alcançam os postos de trabalho associados e trabalham durante o ciclo.",
        ],
        steps: [
          edition === "JAVA"
            ? "Confirme que os aldeões alcançam as camas. Observe se já existe um golem nas proximidades dos aldeões e se algum aparece fora da plataforma."
            : "Observe o vínculo dos aldeões com camas e postos. Confira se a vila está na área simulada e se o local de geração fica perto do centro efetivo da vila.",
          "Deixe espaço acima da superfície de geração. Observe a plataforma e a área em volta antes de testar a condução ao ponto de coleta.",
          details.farm === "no-item"
            ? "Se o golem aparece mas o baú fica vazio, observe onde ele cai e teste o trecho final da coleta com um item comum."
            : "Quando um golem aparecer, acompanhe seu deslocamento até a coleta. Verifique a condução e teste o coletor separadamente com um item comum.",
        ],
        compatibility:
          edition === "JAVA"
            ? "Use os critérios de convocação dos aldeões da Java Edition."
            : "Use os requisitos de vila da Bedrock Edition.",
        verification:
          "Registre se um golem apareceu na área esperada e se os itens chegaram ao coletor. Se falhar, anote em qual das duas etapas o resultado divergiu.",
        warnings: [
          "Este checklist cobre o diagnóstico e o planejamento. Dimensões finais, velocidade e produção dependem da montagem validada.",
        ],
      },
      sources: [golemSource],
    }),
  },
  "builder-base-21": {
    mode: "BUILDER",
    topic: "planta de base 21 × 21",
    versions: supportedVersions,
    verification: "CALCULATED",
    build: () => {
      const { length, width, wallHeight } = builderBaseDimensions;
      const square = { length, width };
      const platform = estimateBlocks("platform", square);
      const walls = estimateBlocks("walls", { ...square, height: wallHeight });
      return {
        answer: {
          text: "Planeje uma base térrea de 21 × 21. Use a faixa central para a circulação e distribua armazenamento, fabricação e descanso nos lados.",
          prerequisites: [
            "Escolha uma superfície nivelada ou prepare o terreno antes de marcar a planta.",
          ],
          steps: [
            "Marque os quatro cantos e conte 21 posições em cada lado, incluindo os cantos.",
            "Preencha o piso com uma camada. Marque a entrada e o corredor central antes de instalar divisórias.",
            "Planeje portas e janelas nas paredes. Na calculadora de materiais, use 21 × 21 e ajuste a altura ao projeto.",
          ],
          materials: [
            {
              name: "Piso completo de uma camada",
              quantity: platform,
              unit: "blocos",
              estimated: false,
            },
            {
              name: "Reserva para paredes de 3 blocos de altura",
              quantity: walls,
              unit: "blocos",
              estimated: true,
            },
          ],
          compatibility:
            "Cálculo geométrico em blocos inteiros, aplicável a Java e Bedrock. Piso: 21 × 21. Paredes brutas, contando cada canto uma vez: (4 × 21 − 4) × 3.",
          verification:
            "Confira 441 posições no piso e 80 posições em cada fiada de perímetro. Desconte da reserva os blocos de portas e janelas quando definir os vãos.",
          warnings: [
            "A reserva das paredes pressupõe três fiadas, sem aberturas. Teto, fundação, divisórias e decoração dependem da planta final.",
          ],
        },
        sources: [],
      };
    },
  },
  "command-help": {
    mode: "COMMAND",
    topic: "consulta de sintaxe e permissões com /help",
    versions: supportedVersions,
    verification: "DOCUMENTED",
    build: ({ edition }) => ({
      answer: {
        text: "No chat do Minecraft, use /help para conferir quais comandos estão disponíveis para sua conta nesse mundo.",
        prerequisites: ["Abra o chat do mundo ou servidor em que pretende usar o comando."],
        steps: [
          "Digite /help e envie no chat do jogo.",
          "Para consultar a sintaxe de um comando que apareceu na lista, digite /help seguido do nome desse comando.",
          edition === "JAVA"
            ? "Se o comando desejado não estiver na lista, confira sua permissão no servidor e se essa versão disponibiliza o comando."
            : "Se houver mais páginas, use /help 2 para consultar a segunda. Confira com o responsável pelo mundo as permissões para o comando que pretende usar.",
        ],
        compatibility:
          edition === "JAVA"
            ? "Na Java Edition, a ajuda considera o que o executor pode usar. A lista pode mudar com as permissões do jogador."
            : "Na Bedrock Edition, /help está disponível sem habilitar trapaças. Outros comandos têm requisitos próprios.",
        verification:
          "O jogo deve mostrar a lista ou a sintaxe solicitada no chat. Quando o jogo recusar ou omitir um comando, verifique as permissões e a disponibilidade nessa versão.",
        warnings: [
          "O MinePRO fornece a instrução. Execute a consulta no Minecraft para observar o resultado.",
        ],
      },
      sources:
        edition === "JAVA"
          ? [
              {
                title: "Minecraft Wiki · Sintaxe de /help para Java",
                url: "https://minecraft.wiki/w/Commands/help#Syntax",
              },
            ]
          : [
              {
                title: "Microsoft Learn · /help para Bedrock",
                url: "https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/help?view=minecraft-bedrock-stable",
              },
            ],
    }),
  },
  "mods-triage": {
    mode: "MODS",
    topic: "triagem de mods Fabric e add-ons de mundo",
    versions: supportedVersions,
    verification: "DOCUMENTED",
    build: ({ edition }, details) => ({
      answer: {
        text: "Reproduza o problema em uma cópia para descobrir qual mudança acompanha a falha. Um erro de versão ou dependência é uma hipótese até ser confirmado.",
        prerequisites: [
          "Use uma cópia do mundo ou um perfil de teste sem mexer na instalação usada para jogar.",
          "Anote localmente a versão do jogo, a lista e as versões dos itens em teste. Use somente a descrição genérica do erro na conversa.",
        ],
        steps:
          edition === "JAVA"
            ? [
                "Abra um perfil Fabric de teste para a versão do jogo selecionada e confirme que ele chega ao menu sem os mods em investigação.",
                "Confira se os mods são para Fabric e para a versão do jogo. Verifique a versão do loader e inclua as dependências exigidas pelo autor do mod.",
                details.issue === "dependency"
                  ? "Compare a dependência pedida com a versão instalada, ajuste somente essa diferença no perfil de teste e repita o teste."
                  : "Adicione um mod por vez, junto às dependências necessárias, e repita a mesma ação. Anote a primeira combinação com que o problema reaparece.",
              ]
            : [
                "Em uma cópia do mundo, confira as seções de pacotes de comportamento e de recursos.",
                "Reveja a compatibilidade anunciada para a versão do jogo e confira se o pacote depende de outro pacote.",
                "Teste a cópia com um conjunto mínimo de pacotes. Acrescente um pacote ou par dependente por vez e repita a ação que apresentava o problema.",
              ],
        compatibility:
          edition === "JAVA"
            ? "Triagem para Fabric no Java. O checklist não cobre Forge, NeoForge ou Quilt."
            : "Triagem de pacotes aplicados ao mundo na Bedrock Edition. Use os controles de pacotes disponíveis na sua plataforma.",
        verification:
          "Repita a ação com e sem a alteração em uma cópia. Uma falha que reaparece com a mesma combinação indica um suspeito que pode ser reproduzido.",
        warnings: [
          "Compartilhe somente uma frase sanitizada sobre o sintoma. Mantenha arquivos, caminhos pessoais, senhas e tokens fora da conversa.",
          "Uma mudança por vez ajuda a separar hipóteses. O checklist não confirma uma causa pelos sintomas informados.",
        ],
      },
      sources:
        edition === "JAVA"
          ? [
              {
                title: "Fabric · Compatibilidade de mods e instalação",
                url: "https://docs.fabricmc.net/players/installing-mods",
              },
            ]
          : [
              {
                title: "Microsoft Learn · Pacotes de comportamento e dependências",
                url: "https://learn.microsoft.com/en-us/minecraft/creator/documents/behaviorpack?view=minecraft-bedrock-stable",
              },
            ],
    }),
  },
  "survival-mining": {
    mode: "SURVIVAL",
    topic: "mineração inicial de carvão, ferro ou diamante",
    versions: supportedVersions,
    verification: "DOCUMENTED",
    build: (_context: MinecraftContext, details) => {
      const ore = pickaxeSources[details.resource!];
      const tool = details.pickaxe!;
      const suitable = ore.levels.includes(tool);
      const toolAdvice =
        tool === "none"
          ? "Você informou que não tem uma picareta."
          : "A ferramenta informada não atende ao requisito.";
      return {
        answer: {
          text: suitable
            ? `Sua picareta atende ao requisito para obter ${ore.label} do minério com um teste direto no jogo.`
            : `Antes de minerar ${ore.label}, prepare uma picareta de ${ore.minimum} ou outra adequada. ${toolAdvice}`,
          prerequisites: [
            `Ferramenta para o minério: picareta de ${ore.minimum} ou superior no nível de mineração.`,
            "Separe tochas, comida e blocos para marcar e recuperar o caminho.",
          ],
          steps: [
            suitable
              ? "Mantenha a ferramenta pronta e confira a durabilidade antes de sair."
              : "Organize primeiro a obtenção da ferramenta indicada. Se já encontrou o minério, marque o caminho e volte com a ferramenta adequada.",
            "Comece por uma rota curta com saída identificada. Ilumine o caminho e evite remover blocos diretamente abaixo dos pés.",
            `Ao encontrar minério de ${ore.label}, confira o entorno e mine um bloco com a ferramenta apropriada. Guarde o resultado antes de continuar.`,
          ],
          verification:
            "Confira o drop no inventário. Toque Suave requer uma picareta de nível adequado para obter o próprio bloco de minério. Com uma picareta inadequada, o bloco não rende drop, mesmo com o encantamento.",
          warnings: [
            "Roteiro conservador para progressão inicial. Localização, altura Y, frequência e quantidade de minério não foram estimadas.",
          ],
        },
        sources: [ore.source],
      };
    },
  },
};

export function procedureCompatibility(context: Answer["context"]): string {
  return `Contexto validado no catálogo para ${EDITIONS[context.edition].description} ${context.game_version}.`;
}
