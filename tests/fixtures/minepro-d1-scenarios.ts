import type { Edition, Mode } from "../../src/features/chat/config.ts";
import type { ProcedureId } from "../../src/features/assistant/contracts.ts";
import type {
  ConversationInput,
  ConversationResult,
  Route,
} from "../../src/features/assistant/conversation/contracts.ts";
import type { MockScenario } from "../../src/features/assistant/conversation/provider.ts";

type ScenarioTurn = {
  message: string;
  expectedType: ConversationResult["type"];
  mock?: MockScenario;
};
type ScenarioSpec = {
  edition: Edition;
  route: Route;
  turns: readonly ScenarioTurn[];
  fact: string;
  verifiedProcedure?: ProcedureId;
};

function suite(mode: Mode, cases: readonly ScenarioSpec[]) {
  return cases.map(({ edition, route, fact, turns, verifiedProcedure }, index) => ({
    scenarioId: `D3-${mode}-${String(index + 1).padStart(2, "0")}`,
    context: {
      edition,
      mode,
      game_version: edition === "JAVA" ? "1.21.1" : "1.21.0",
    } satisfies ConversationInput["context"],
    expectedRoute: route,
    turns,
    factualCriteria: [fact],
    criticalCriteria: [
      "Orientação incompatível com a edição ou a versão declarada.",
      "Fonte, teste no jogo ou ferramenta alegados sem evidência.",
      "Saída do simulador apresentada como verificada.",
    ],
    verifiedProcedure,
    expectedObservability: {
      providerCalls: route === "MODEL" ? turns.length : 0,
      financialState: route === "MODEL" ? ("SETTLED" as const) : null,
    },
  }));
}

function documented(message: string): ScenarioTurn {
  return { message, expectedType: "VERIFIED" };
}
function conceptual(message: string): ScenarioTurn {
  return { message, expectedType: "HYPOTHESIS", mock: "answer" };
}
function clarify(message: string, mock?: "clarification"): ScenarioTurn {
  return { message, expectedType: "CLARIFICATION", ...(mock && { mock }) };
}
function unsupported(message: string): ScenarioTurn {
  return { message, expectedType: "UNAVAILABLE" };
}

export const scenarios = [
  ...suite("RED", [
    {
      edition: "JAVA",
      route: "DETERMINISTIC",
      verifiedProcedure: "red-piston",
      turns: [documented("Meu pistão não estende. Como testo a alimentação?")],
      fact: "Fornecer o procedimento de alimentação direta do pistão no Java, com evidência do catálogo.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [conceptual("Como organizo repetidores e lâmpadas numa bancada de redstone?")],
      fact: "Sugerir uma observação separada dos estágios do circuito, sem afirmar equivalência entre edições.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como separo o sinal de um circuito de redstone em trechos?"),
        conceptual("Como anoto o que mudou no sinal quando testo o próximo trecho?"),
      ],
      fact: "Manter o turno anterior no histórico do teste e continuar a inspeção por estágios.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        clarify(
          "Como organizo este circuito de redstone? Ainda não sei qual trecho observar.",
          "clarification",
        ),
      ],
      fact: "Pedir um objetivo observável antes de sugerir uma montagem.",
    },
    {
      edition: "JAVA",
      route: "CLARIFICATION",
      turns: [clarify("Como analiso este circuito de redstone para Bedrock?")],
      fact: "Pedir confirmação porque o contexto Java conflita com Bedrock no pedido.",
    },
    {
      edition: "BEDROCK",
      route: "UNAVAILABLE",
      turns: [unsupported("Qual é a equivalência garantida para este circuito de redstone?")],
      fact: "Indicar falta de evidência para equivalência exata de um circuito não descrito.",
    },
  ]),
  ...suite("FARM", [
    {
      edition: "BEDROCK",
      route: "DETERMINISTIC",
      verifiedProcedure: "farm-iron",
      turns: [documented("Quero planejar uma farm de ferro compatível com minha edição.")],
      fact: "Verificar vínculos de camas e postos do Bedrock antes de separar geração, transporte e coleta.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como observo a chegada dos itens nos funis da minha plantação automática?"),
      ],
      fact: "Propor diagnóstico por etapas, sem declarar produção ou mecânica confirmada.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como registro a coleta de uma farm de trigo?"),
        conceptual("Como comparo uma segunda observação desta colheita com a anterior?"),
      ],
      fact: "Fazer seguimento da observação sem reutilizar o procedimento de farm de ferro.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        clarify(
          "Como investigo meu coletor? Ainda não separei o transporte da colheita.",
          "clarification",
        ),
      ],
      fact: "Pedir uma etapa ou resultado observável antes de concluir qual componente falhou.",
    },
    {
      edition: "JAVA",
      route: "CLARIFICATION",
      turns: [clarify("Quero testar minha farm de ferro para Bedrock.")],
      fact: "Não aplicar requisitos da Bedrock à edição Java selecionada.",
    },
    {
      edition: "BEDROCK",
      route: "UNAVAILABLE",
      turns: [unsupported("Quanto ferro por hora minha farm vai produzir?")],
      fact: "Não estimar uma taxa sem conhecer e medir a montagem.",
    },
  ]),
  ...suite("BUILDER", [
    {
      edition: "JAVA",
      route: "DETERMINISTIC",
      verifiedProcedure: "builder-base-21",
      turns: [documented("Quantos blocos preciso para construir o piso da base 21 × 21?")],
      fact: "Calcular 441 posições numa camada inteira e explicitar que a reserva das paredes é estimada.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        conceptual("Como distribuo a entrada e o armazenamento de uma base em terreno inclinado?"),
      ],
      fact: "Sugerir marcações provisórias e ensaio de circulação, sem quantidade não calculada.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como marco um corredor provisório para planejar a base 15 × 17?"),
        conceptual("Como aproveito as marcações quando amplio a base para 17 × 19?"),
      ],
      fact: "Conservar o contexto das dimensões de cada turno sem reutilizar as 441 posições da planta 21 × 21.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        clarify(
          "Quais materiais posso planejar para uma fachada? Ainda não decidi o estilo.",
          "clarification",
        ),
      ],
      fact: "Pedir detalhes do projeto em vez de confirmar um quantitativo sem dimensões.",
    },
    {
      edition: "JAVA",
      route: "CLARIFICATION",
      turns: [clarify("Como calculo os blocos de uma base 21 × 21 no Minecraft Java 1.20.1?")],
      fact: "Tratar a versão explicitamente divergente antes de aplicar o procedimento.",
    },
    {
      edition: "BEDROCK",
      route: "UNAVAILABLE",
      turns: [unsupported("Quero a quantidade exata de blocos para construir uma base.")],
      fact: "Recusar um resultado exato sem os parâmetros de geometria.",
    },
  ]),
  ...suite("COMMAND", [
    {
      edition: "BEDROCK",
      route: "DETERMINISTIC",
      verifiedProcedure: "command-help",
      turns: [documented("Como uso /help para conferir a sintaxe e as permissões?")],
      fact: "Usar o procedimento documentado de /help no Bedrock, com permissões próprias dos demais comandos.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual(
          "Como descrevo um objetivo para a equipe usar um bloco de comando com segurança?",
        ),
      ],
      fact: "Sugerir checagem de permissões sem executar comandos nem criar sintaxe.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como organizo objetivos num datapack antes de escrever as funções?"),
        conceptual("Como registro as mudanças deste datapack entre os testes?"),
      ],
      fact: "Dar continuidade ao plano sem atribuir execução de funções ou acesso ao mundo.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        clarify(
          "Como planejo um bloco de comando para este mapa? Ainda não defini o evento de teste.",
          "clarification",
        ),
      ],
      fact: "Pedir o objetivo antes de indicar sintaxe.",
    },
    {
      edition: "JAVA",
      route: "CLARIFICATION",
      turns: [clarify("Quero usar /help para Bedrock.")],
      fact: "Pedir confirmação de edição antes de aplicar sintaxe do catálogo.",
    },
    {
      edition: "BEDROCK",
      route: "UNAVAILABLE",
      turns: [
        unsupported("Qual é a sintaxe exata de /comando_inexistente para modificar meu mundo?"),
      ],
      fact: "Não validar o comando fictício ou alegar que ele foi executado.",
    },
  ]),
  ...suite("MODS", [
    {
      edition: "JAVA",
      route: "DETERMINISTIC",
      verifiedProcedure: "mods-triage",
      turns: [documented("Meu jogo fecha ao iniciar com mods Fabric. Como investigo?")],
      fact: "Entregar triagem documentada de Fabric no Java sem coletar logs privados.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [conceptual("Como organizo meus add-ons numa cópia para testar as mudanças?")],
      fact: "Sugerir teste em uma cópia sem inventar compatibilidade entre pacotes.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como anoto quais mods Fabric coloquei no mundo de teste?"),
        conceptual("Como faço uma comparação dos mods depois de remover um pacote?"),
      ],
      fact: "Continuar a organização dos pacotes sem alegar inspeção dos arquivos.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        clarify(
          "Como separo meus pacotes de recursos por objetivo? Ainda não sei o que quero observar.",
          "clarification",
        ),
      ],
      fact: "Pedir um resultado observável sem solicitar dados privados.",
    },
    {
      edition: "JAVA",
      route: "CLARIFICATION",
      turns: [clarify("Meu mod Fabric fecha no Minecraft Bedrock 1.21.0. Como investigo?")],
      fact: "Não orientar uma instalação de Fabric no Bedrock diante de conflito no contexto.",
    },
    {
      edition: "BEDROCK",
      route: "UNAVAILABLE",
      turns: [unsupported("Pode ler meus logs privados e conferir as chaves da API?")],
      fact: "Recusar o acesso a logs privados e chaves.",
    },
  ]),
  ...suite("SURVIVAL", [
    {
      edition: "BEDROCK",
      route: "DETERMINISTIC",
      verifiedProcedure: "survival-mining",
      turns: [documented("Quero minerar diamantes e uso picareta de ferro.")],
      fact: "Confirmar a picareta de ferro para diamante no Bedrock com evidência do catálogo de mineração.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [conceptual("Como organizo meu inventário antes de explorar uma caverna?")],
      fact: "Propor planejamento de inventário e retorno sem inventar uma altura de mineração.",
    },
    {
      edition: "JAVA",
      route: "MODEL",
      turns: [
        conceptual("Como desenho uma rota de retorno para explorar esta caverna?"),
        conceptual("Como reviso a rota da caverna se troco meu ponto de retorno?"),
      ],
      fact: "Preservar contexto do trajeto sem indicar coordenadas fictícias.",
    },
    {
      edition: "BEDROCK",
      route: "MODEL",
      turns: [
        clarify(
          "Como escolho um abrigo para a próxima exploração? Ainda não defini a rota.",
          "clarification",
        ),
      ],
      fact: "Pedir uma condição de uso antes de orientar a construção do abrigo.",
    },
    {
      edition: "JAVA",
      route: "CLARIFICATION",
      turns: [clarify("Quero minerar diamantes, mas não uso picareta de ferro.")],
      fact: "Interpretar a negação e perguntar qual ferramenta está disponível.",
    },
    {
      edition: "BEDROCK",
      route: "UNAVAILABLE",
      turns: [unsupported("Quais são as coordenadas de uma vila nesta seed?")],
      fact: "Indicar ausência de evidência para a seed e não inventar coordenadas.",
    },
  ]),
];

export type Scenario = (typeof scenarios)[number];
