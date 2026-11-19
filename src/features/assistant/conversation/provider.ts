import type { MinecraftContext, Mode } from "../../chat/config.ts";
import { only, record, unavailable, type ConversationResult } from "./contracts.ts";

export const MOCK_MODEL = "D1_FICTITIOUS";
export const MODEL_TIMEOUT_MS = 30_000;
export const SYNTHETIC_PRICING = {
  version: "D1-virtual-v1",
  inputMicrosPerUnit: 2,
  outputMicrosPerUnit: 5,
  maxOutputUnits: 128,
} as const;

export type ModelPrompt = {
  instructions: string;
  context: MinecraftContext;
  focus: Mode;
  message: string;
  history: readonly { context: MinecraftContext; message: string; reply: string }[];
  maxOutputUnits: number;
};

export type ModelAdapter = {
  readonly id: string;
  invoke: (prompt: ModelPrompt, signal: AbortSignal) => Promise<unknown>;
};

export type SyntheticUsage = { inputUnits: number; outputUnits: number };

export type MockScenario =
  | "answer"
  | "clarification"
  | "unavailable"
  | "timeout"
  | "transport-error"
  | "invalid-response"
  | "unknown-usage"
  | "overcharge"
  | "false-verification"
  | "invented-source"
  | "unsafe-content";

const guidance: Record<Mode, string> = {
  RED: "Desenhe o trajeto do sinal e numere os trechos. Observe cada estágio antes de ligar todos na mesma montagem.",
  FARM: "Separe a chegada dos itens, o transporte e a coleta. Observe cada etapa com a mesma configuração antes de ajustar o projeto.",
  BUILDER:
    "Marque o perímetro e a entrada com blocos temporários. Experimente a circulação e duas paletas pequenas antes de fechar as paredes.",
  COMMAND:
    "Anote o objetivo e confirme as permissões com o responsável pelo mundo. Consulte a ajuda disponível no próprio jogo para verificar a sintaxe.",
  MODS: "Registre a versão visível de cada pacote e reproduza o problema numa cópia do mundo. Mude um pacote por vez para comparar o resultado.",
  SURVIVAL:
    "Planeje pontos de retorno, espaço no inventário e uma rota iluminada. Compare o risco de cada trajeto antes de levar todo o equipamento.",
};
const limitation =
  "Conteúdo fictício para teste de D1. Compatibilidade e resultados in-game não foram verificados.";

export function inputUnits(prompt: ModelPrompt): number {
  // Synthetic units are UTF-8 bytes of the full transmitted object, including history.
  return new TextEncoder().encode(JSON.stringify(prompt)).length;
}

function usageCost(input: number, output: number): number {
  return (
    input * SYNTHETIC_PRICING.inputMicrosPerUnit + output * SYNTHETIC_PRICING.outputMicrosPerUnit
  );
}

export function maximumCharge(prompt: ModelPrompt): number {
  return usageCost(inputUnits(prompt), prompt.maxOutputUnits);
}

function parseUsage(value: unknown): SyntheticUsage | undefined {
  if (!record(value) || !only(value, ["inputUnits", "outputUnits"])) return;
  const { inputUnits: input, outputUnits: output } = value;
  const units = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000;
  if (units(input) && units(output)) return { inputUnits: input, outputUnits: output };
}

export function decodeProviderResult(raw: unknown, prompt: ModelPrompt) {
  const usage = record(raw) ? parseUsage(raw.usage) : undefined;
  const charge = usage && usageCost(usage.inputUnits, usage.outputUnits);
  let result: ConversationResult | undefined;
  // The simulator selects closed fixtures. Only the server supplies wording and provenance.
  if (record(raw) && only(raw, ["reply", "usage"]) && charge !== undefined) {
    switch (raw.reply) {
      case "answer":
        result = {
          type: "HYPOTHESIS",
          origin: "MODEL",
          text: `Simulação D1. ${prompt.history.length ? "Como próximo passo, retome a observação anterior. " : ""}${guidance[prompt.focus]}`,
          simulated: true,
          sources: [],
          limitations: [limitation],
        };
        break;
      case "clarification":
        result = {
          type: "CLARIFICATION",
          origin: "MODEL",
          text: "Simulação D1. O que você já montou e qual resultado quer observar primeiro?",
          simulated: true,
        };
        break;
      case "unavailable":
        result = unavailable("SIMULATOR_UNAVAILABLE");
    }
  }
  return { usage, charge, result };
}

export function createMockProvider(
  select: MockScenario | ((prompt: ModelPrompt) => MockScenario) = "answer",
): ModelAdapter {
  return {
    id: MOCK_MODEL,
    async invoke(prompt, signal) {
      signal.throwIfAborted();
      const scenario = typeof select === "function" ? select(prompt) : select;
      const usage = {
        inputUnits: inputUnits(prompt),
        outputUnits: scenario === "overcharge" ? prompt.maxOutputUnits + 1 : 32,
      };
      switch (scenario) {
        case "timeout":
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        case "transport-error":
          throw new Error("Synthetic transport interruption");
        case "invalid-response":
          return { reply: { type: 42 }, usage };
        case "unknown-usage":
          return { reply: "answer" };
        case "false-verification":
          return { reply: "VERIFIED", usage };
        case "invented-source":
          return {
            reply: "answer",
            sources: [{ title: "Synthetic untrusted source", url: "https://example.invalid" }],
            usage,
          };
        case "unsafe-content":
          return { reply: "answer", text: "Conteúdo fora dos fixtures do servidor.", usage };
        case "clarification":
        case "unavailable":
          return { reply: scenario, usage };
        default:
          return { reply: "answer", usage };
      }
    },
  };
}
