import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { assessCommands } from "../ai-command-audit/commands.ts";
import { asObject } from "../ai-bench/local.ts";
import { resolveQuestion } from "./questions.ts";
import { type CommandContext, validateCandidate } from "./validate.ts";

const diagnosticHash = "823fb35681fd70d68f2ab9d1d66effef08559af3096b92c549c894308d01e33a";
const replayCases = [
  { id: "CMD-J02", family: "/weather", reference: "/weather clear" },
  { id: "AMB-B01", family: "/fill", reference: "/fill" },
] as const;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function auditWeather(context: CommandContext, text: string) {
  const issues = [];
  const mentions = assessCommands(text, "/weather clear").mentions;
  const recommended = mentions.filter((mention) => mention.presentation === "presented");
  const weather = recommended.filter((mention) => mention.text.startsWith("/weather "));
  if (recommended.some((mention) => /^\/time (?:set|add)\b/u.test(mention.text))) {
    issues.push("altera-horario");
  }
  if (weather.some((mention) => validateCandidate(context, mention.text).status === "invalid")) {
    issues.push("parametros-de-clima-incorretos");
  }
  if (weather.some((mention) => /^\/weather (?:rain|thunder)\b/u.test(mention.text))) {
    issues.push("clima-diverge-da-intencao");
  }
  if (issues.length) return { outcome: "fail", issues } as const;
  const clears = weather.some((mention) => {
    const candidate = validateCandidate(context, mention.text);
    return candidate.status === "ready" && /^\/weather clear(?:\s|$)/u.test(candidate.command);
  });
  const preserves =
    /\b(?:preserva (?:o )?horário|sem (?:mudar|alterar) (?:o )?horário|independentemente da hora do dia)\b/iu.test(
      text,
    );
  const contradicts =
    /\b(?:não preserva|reseta(?: automaticamente)?|redefine|muda|altera) (?:o )?(?:horário|hora do dia)\b/iu.test(
      text.replace(/\bsem (?:mudar|alterar) (?:o )?horário\b/giu, ""),
    );
  if (contradicts)
    return { outcome: "fail", issues: ["explicacao-contradiz-preservacao-do-horario"] } as const;
  return { outcome: clears && preserves ? "pass" : "inconclusive", issues } as const;
}

function auditFill(context: CommandContext, text: string) {
  const issues = [];
  const mentions = assessCommands(text, "/fill").mentions.filter(
    (mention) => /^\/fill\s/u.test(mention.text) && mention.presentation === "presented",
  );
  for (const mention of mentions) {
    if (validateCandidate(context, mention.text).status === "invalid")
      issues.push("parametros-de-preenchimento-incorretos");
    issues.push("regiao-nao-fornecida-pelo-jogador");
  }
  if (issues.length) return { outcome: "fail", issues: [...new Set(issues)] } as const;
  if (
    /\b(?:bloco|ID do bloco)(?: de destino)?\s+(?:no formato|em formato|como)\s+`?x y z\b/iu.test(
      text,
    )
  ) {
    return { outcome: "fail", issues: ["confunde-identificador-com-coordenadas"] } as const;
  }
  const corners =
    /\b(?:coordenadas dos dois pontos opostos|primeiro canto XYZ, segundo canto XYZ)\b/iu.test(
      text,
    );
  const block = /\b(?:ID do bloco de destino|bloco que deseja colocar)\b/iu.test(text);
  return { outcome: corners && block ? "pass" : "inconclusive", issues } as const;
}

export async function replayValidation(input: Buffer) {
  const archive = asObject(JSON.parse(input.toString("utf8")));
  const rows = Array.isArray(archive.cases) ? archive.cases.map(asObject) : [];
  if (
    archive.scope !== "diagnostic-regression" ||
    archive.schemaVersion !== 1 ||
    asObject(archive.fingerprint).dataset !== diagnosticHash ||
    rows.length !== 24 ||
    new Set(rows.map((row) => row.caseId)).size !== 24
  ) {
    throw new Error("Forneça a comparação arquivada dos 24 diagnósticos da Fase 3B.");
  }
  const bytes = await readFile(new URL("../ai-bench/cases.json", import.meta.url));
  if (sha256(bytes) !== diagnosticHash) throw new Error("Hash do conjunto diagnóstico divergente.");
  const suite = JSON.parse(bytes.toString("utf8")) as {
    cases: { id: string; question: string; edition: string; version: string }[];
  };
  if (rows.some((row) => !suite.cases.some((item) => item.id === row.caseId))) {
    throw new Error("Caso fora do conjunto diagnóstico.");
  }
  const cases = replayCases.map(({ id, family, reference }) => {
    const row = rows.find((item) => item.caseId === id);
    const diagnostic = suite.cases.find((item) => item.id === id);
    if (!row || !diagnostic) throw new Error(`Caso diagnóstico ausente: ${id}.`);
    const context = { edition: diagnostic.edition, version: diagnostic.version };
    const audit = family === "/weather" ? auditWeather : auditFill;
    const result = resolveQuestion(context, diagnostic.question);
    const text =
      result.status === "ready"
        ? `Use \`${result.command}\`. ${result.message}`
        : result.status === "outside-scope"
          ? null
          : result.message;
    const after =
      text === null ? ({ outcome: "inconclusive", issues: [] } as const) : audit(context, text);
    const comparisons = (["base", "rag"] as const).map((variant) => {
      const source = asObject(row[variant]);
      const review = asObject(row[`${variant}Review`]);
      const answer = asObject(source.answer).text;
      if (
        typeof answer !== "string" ||
        sha256(answer) !== source.answerSha256 ||
        review.answerSha256 !== source.answerSha256 ||
        source.caseId !== id ||
        review.caseId !== id ||
        !["correct", "partial", "incorrect"].includes(String(review.factual))
      ) {
        throw new Error(`Texto ou nota histórica divergente: ${id} ${variant}.`);
      }
      const before = audit(context, answer);
      const change =
        before.outcome === "inconclusive" || after.outcome === "inconclusive"
          ? "inconclusive"
          : before.outcome === after.outcome
            ? "maintained"
            : after.outcome === "pass"
              ? "improved"
              : "regressed";
      return {
        variant,
        sha256: source.answerSha256,
        historicalGrade: review.factual,
        before,
        change,
      };
    });
    return {
      id,
      reference,
      context,
      comparisons,
      prototype: {
        ...result,
        text,
        sha256: text === null ? null : sha256(text),
        assessment: after,
      },
    };
  });
  return {
    scope: "development-command-replay",
    sourceSha256: sha256(input),
    diagnosticHash,
    cases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { in: { type: "string" }, out: { type: "string" } } });
    if (!values.in || !values.out)
      throw new Error("Use --in COMPARACAO-3B.json --out RESULTADO.json.");
    const report = await replayValidation(await readFile(values.in));
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Falha no replay."}\n`);
    process.exitCode = 1;
  }
}
