export type CommandContext = { edition?: string | null; version?: string | null };
export type FillMode = "replace" | "keep" | "outline" | "hollow" | "destroy";
export type CommandIntent =
  | { command: "weather"; state?: string; duration?: string }
  | {
      command: "fill";
      from?: readonly string[];
      to?: readonly string[];
      block?: string;
      mode?: string;
      preserveExisting?: boolean;
      acceptDestructive?: boolean;
    };

export type CommandResult =
  | { status: "outside-scope"; reason: string }
  | { status: "clarify" | "invalid" | "caution"; fields: string[]; message: string }
  | { status: "ready"; command: string; message: string };

const supportedVersions = { Java: "1.21.5", Bedrock: "1.21.80" } as const;
const states = new Set(["clear", "rain", "thunder", "query"]);
const modes: Record<FillMode, string> = {
  replace: "Pode substituir todos os blocos da região, inclusive construções.",
  keep: "Preenche apenas o ar, preservando os blocos existentes.",
  outline: "Pode substituir os blocos da borda e preserva o interior.",
  hollow: "Substitui a borda e esvazia o interior.",
  destroy: "Quebra os blocos existentes e pode gerar itens soltos antes de preencher.",
};
const blocks = new Set(["stone", "cobblestone", "glass", "dirt", "oak_planks", "air"]);
const itemOnly = new Set(["stick", "diamond_sword", "apple"]);
const integer = /^-?\d{1,8}$/u;
const javaDuration = /^(\d+(?:\.\d*)?|\.\d+)([dst]?)$/u;
// A development guardrail. Java's actual command limit can be configured in the world.
const MAX_REGION = 32_768;

function outside(reason: string): CommandResult {
  return { status: "outside-scope", reason };
}

function problem(
  status: "clarify" | "invalid" | "caution",
  fields: string[],
  message: string,
): CommandResult {
  return { status, fields, message };
}

function blockId(value: string) {
  return value.startsWith("minecraft:") ? value.slice("minecraft:".length) : value;
}

function weatherDuration(edition: string, duration: string) {
  if (edition === "Bedrock") {
    return /^\d+$/u.test(duration) && Number(duration) <= 1_000_000 ? Number(duration) : null;
  }
  const match = javaDuration.exec(duration);
  if (!match) return null;
  const unit = match[2] === "d" ? 24_000 : match[2] === "s" ? 20 : 1;
  // Java parses a float and rounds the result in game ticks.
  const ticks = Math.round(Math.fround(Math.fround(Number(match[1])) * unit));
  return ticks >= 1 && ticks <= 2_147_483_647 ? ticks : null;
}

export function validateIntent(context: CommandContext, intent: CommandIntent): CommandResult {
  const { edition, version } = context;
  if (edition != null && edition !== "Java" && edition !== "Bedrock")
    return outside("Edição fora do protótipo.");
  if (edition && version && version !== supportedVersions[edition])
    return outside("Versão fora do protótipo.");
  const fields = [];
  if (!edition) fields.push("edição");
  if (!version) fields.push("versão exata");

  if (intent.command === "weather") {
    const { state, duration } = intent;
    if (!state) fields.push("clima desejado");
    if (fields.length) return problem("clarify", fields, `Informe ${fields.join(", ")}.`);
    if (!state || !states.has(state) || (state === "query" && edition !== "Bedrock")) {
      return problem(
        "invalid",
        ["clima"],
        "O estado ou a consulta é incompatível com essa edição.",
      );
    }
    if (state === "query" && duration !== undefined) {
      return problem("invalid", ["duração"], "A consulta de clima no Bedrock não aceita duração.");
    }
    let timing = "";
    if (duration !== undefined) {
      const ticks = weatherDuration(edition ?? "", duration);
      if (ticks === null) {
        return problem(
          "invalid",
          ["duração"],
          edition === "Bedrock"
            ? "No Bedrock, a duração deste comando deve ser um inteiro de 0 a 1.000.000 ticks."
            : "No Java, informe uma duração representável de pelo menos um tick. As unidades são t, s e d.",
        );
      }
      timing =
        ticks === 0
          ? " No Bedrock, zero usa a duração padrão aleatória."
          : ` Duração configurada em ${ticks} ticks.`;
    }
    const command = `/weather ${state}${duration === undefined ? "" : ` ${duration}`}`;
    const message =
      state === "query"
        ? "Consulta o clima atual e preserva o horário."
        : `Altera o clima e preserva o horário.${timing} ${state === "thunder" ? "A tempestade pode produzir raios. " : ""}O ciclo de clima continua conforme as regras do mundo.`;
    return { status: "ready", command, message };
  }

  const { from, to, block } = intent;
  if (!from) fields.push("primeiro canto XYZ");
  if (!to) fields.push("segundo canto XYZ");
  if (!block) fields.push("ID do bloco de destino");
  if (fields.length) return problem("clarify", fields, `Informe ${fields.join(", ")}.`);
  if (!from || !to || !block) throw new Error("Campos de preenchimento inconsistentes.");

  const id = blockId(block);
  if (itemOnly.has(id) || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/u.test(block)) {
    return problem(
      "invalid",
      ["ID do bloco de destino"],
      "Use o identificador de um bloco, como minecraft:glass.",
    );
  }
  if (!blocks.has(id)) return outside("ID de bloco fora do catálogo de desenvolvimento.");
  if (from.length !== 3 || to.length !== 3) {
    return problem("invalid", ["coordenadas"], "Cada canto precisa de três coordenadas XYZ.");
  }
  if ([...from, ...to].some((value) => /^[~^]/u.test(value))) {
    return outside("O protótipo exige coordenadas absolutas para calcular o volume.");
  }
  const invalidCorners = [
    [from, "primeiro canto XYZ"],
    [to, "segundo canto XYZ"],
  ] as const;
  const bad = invalidCorners
    .filter(([point]) => point.some((value) => !integer.test(value)))
    .map(([, field]) => field);
  if (bad.length)
    return problem("invalid", bad, "Forneça três números inteiros em cada canto indicado.");
  const outsideBounds = invalidCorners
    .filter(
      ([point]) =>
        Math.abs(Number(point[0])) >= 30_000_000 ||
        Math.abs(Number(point[2])) >= 30_000_000 ||
        Number(point[1]) < -64 ||
        Number(point[1]) > 319,
    )
    .map(([, field]) => field);
  if (outsideBounds.length) {
    return problem(
      "caution",
      outsideBounds,
      "As coordenadas estão fora dos limites conservadores do protótipo. Confira a dimensão e os limites do mundo.",
    );
  }

  const mode = intent.mode ?? (intent.preserveExisting ? "keep" : "replace");
  if (mode === "strict") {
    return edition === "Java"
      ? outside("O modo strict do Java fica fora do protótipo.")
      : problem("invalid", ["modo"], "O modo strict pertence ao Java 1.21.5.");
  }
  if (!Object.hasOwn(modes, mode))
    return problem("invalid", ["modo"], "Modo de preenchimento desconhecido pelo protótipo.");
  if (mode === "keep" && id === "air") {
    return problem(
      "invalid",
      ["ID do bloco de destino"],
      "O modo keep com ar não preenche a região. Informe outro bloco.",
    );
  }
  if (edition === "Bedrock" && mode === "destroy" && id === "air") {
    return outside("O comportamento de destroy com ar no Bedrock precisa ser confirmado em jogo.");
  }
  if (intent.preserveExisting && mode !== "keep") {
    return problem(
      "caution",
      ["modo"],
      "Para preservar os blocos existentes, indique um bloco sólido e use o modo keep.",
    );
  }
  const volume = from.reduce(
    (size, value, i) => size * (Math.abs(Number(value) - Number(to[i])) + 1),
    1,
  );
  if (volume > MAX_REGION) {
    return problem(
      "caution",
      ["coordenadas"],
      "Divida a região ou confira o limite configurado no mundo. O protótipo limita cada região a 32.768 posições.",
    );
  }
  const effects = modes[mode as FillMode];
  const message = `A região contém ${volume} posições. ${id === "air" ? "Preencher com ar pode apagar blocos. " : ""}${effects} Confira os cantos, a dimensão, as áreas carregadas e suas permissões antes de executar.`;
  if ((id === "air" || mode === "hollow" || mode === "destroy") && !intent.acceptDestructive) {
    return problem(
      "caution",
      ["efeito destrutivo"],
      `${message} Confirme que esse efeito é intencional.`,
    );
  }
  return {
    status: "ready",
    command: `/fill ${from.join(" ")} ${to.join(" ")} minecraft:${id} ${mode}`,
    message,
  };
}

export function validateCandidate(context: CommandContext, text: string): CommandResult {
  const candidate = text.trim();
  if (/[\r\n]/u.test(candidate)) {
    return problem("invalid", ["comando"], "Forneça um único comando em uma linha.");
  }
  const [name, ...args] = candidate.split(/[\t ]+/u);
  if (name === "/weather") {
    if (args.length > 2)
      return problem("invalid", ["parâmetros"], "Parâmetros extras no comando de clima.");
    return validateIntent(context, { command: "weather", state: args[0], duration: args[1] });
  }
  if (name !== "/fill") return outside("Comando fora do protótipo.");
  if (/[\[\]{}#]/u.test(args.join(" ")) || (args.length > 8 && args[7] === "replace")) {
    return outside("Estados, tags, NBT e filtros de substituição exigem validação própria.");
  }
  if (context.edition === "Bedrock" && args.length >= 8 && /^-?\d+$/u.test(args[7])) {
    return problem(
      "invalid",
      ["estado de bloco"],
      "O Bedrock 1.21.80 usa estados de bloco no lugar do valor numérico legado.",
    );
  }
  if (args.length < 7 || args.length > 8) {
    return problem(
      "invalid",
      ["parâmetros"],
      "O comando precisa de seis coordenadas, um bloco e, opcionalmente, um modo.",
    );
  }
  return validateIntent(context, {
    command: "fill",
    from: args.slice(0, 3),
    to: args.slice(3, 6),
    block: args[6],
    mode: args[7],
  });
}
