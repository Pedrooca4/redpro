import { createHash } from "node:crypto";
import { join } from "node:path";

import { asObject, BenchError } from "./local.ts";
import { privateDirectory, readPrivateFile } from "./reserved-files.ts";
import type { EvaluationCase } from "./report.ts";

export const RESERVED_NAME = "minepro-ai-3c-bateria-reservada-v2.json";
export const RESERVED_SHA256 = "d54f5086a8ff29bad21175e3935d8ad98db663a2923589146215edb0d007e5f7";
export const RESERVED_COUNT = 72;
const CATEGORIES = new Map([
  ["crafting", "CRA"],
  ["comandos", "CMD"],
  ["redstone", "RED"],
  ["sobrevivencia", "SUR"],
  ["edicoes", "EDI"],
  ["versoes", "VER"],
]);
const LEVELS = ["fácil", "intermediária", "difícil"];
const REFERENCE_HOSTS = new Set([
  "feedback.minecraft.net",
  "learn.microsoft.com",
  "minecraft.wiki",
  "www.minecraft.net",
]);
const HEX_SHA256 = /^[a-f0-9]{64}$/;

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const canonicalHash = (value: unknown) => sha256(canonical(value));

export function parsePrivateJSON(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BenchError("Arquivo privado contém JSON ou UTF-8 inválido.");
  }
}

export type ReservedCase = Omit<EvaluationCase, "exactCommand"> & {
  difficulty: string;
  requiresClarification: boolean;
  referenceSha256: string;
};
type Source = {
  title: string;
  url: string;
  license: string;
  publisher: string;
  usage: string;
  provenanceSha256: string;
};

export function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= limit;
}

function validSource(value: unknown): value is Source {
  const source = asObject(value);
  const { provenanceSha256, ...fields } = source;
  if (
    ![source.title, source.license, source.publisher, source.usage].every((v) =>
      boundedText(v, 500),
    ) ||
    !boundedText(source.url, 1500) ||
    typeof provenanceSha256 !== "string" ||
    !HEX_SHA256.test(provenanceSha256) ||
    canonicalHash(fields) !== provenanceSha256
  )
    return false;
  try {
    const url = new URL(source.url);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      REFERENCE_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function parseReservedSuite(value: unknown) {
  const suite = asObject(value);
  const sources: Record<string, Source> = Object.create(null);
  if (
    suite.schemaVersion !== 1 ||
    suite.revision !== 2 ||
    suite.purpose !== "reserved-evaluation-only" ||
    suite.language !== "pt-BR" ||
    suite.generatedResponses !== 0 ||
    !Array.isArray(suite.cases) ||
    suite.cases.length !== RESERVED_COUNT
  )
    throw new BenchError("A bateria reservada deve conter 72 casos na revisão 2.");
  for (const [id, source] of Object.entries(asObject(suite.sources))) {
    if (!id || !validSource(source)) throw new BenchError("Fonte reservada inválida.");
    sources[id] = source;
  }

  const ids = new Set<string>();
  const questions = new Set<string>();
  const groups = new Map<string, number>();
  const cases = suite.cases.map((row): ReservedCase => {
    const item = asObject(row);
    const {
      id,
      category,
      edition,
      version,
      difficulty,
      question,
      reference,
      criteria,
      criticalError,
      sourceIds,
      referenceSha256,
      requiresClarification,
    } = item;
    if (
      typeof category !== "string" ||
      !CATEGORIES.has(category) ||
      (edition !== "Java" && edition !== "Bedrock") ||
      typeof id !== "string" ||
      !new RegExp(`^RES-${CATEGORIES.get(category)}-${edition[0]}0[1-6]$`).test(id) ||
      ids.has(id) ||
      typeof version !== "string" ||
      !/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(version) ||
      typeof difficulty !== "string" ||
      !LEVELS.includes(difficulty) ||
      !boundedText(question, 1500) ||
      !boundedText(reference, 4000) ||
      !boundedText(criticalError, 1500) ||
      typeof requiresClarification !== "boolean" ||
      !Array.isArray(criteria) ||
      criteria.length === 0 ||
      !criteria.every((criterion) => boundedText(criterion, 1500)) ||
      !Array.isArray(sourceIds) ||
      sourceIds.length === 0 ||
      new Set(sourceIds).size !== sourceIds.length ||
      !sourceIds.every((source) => typeof source === "string" && Object.hasOwn(sources, source)) ||
      typeof referenceSha256 !== "string" ||
      !HEX_SHA256.test(referenceSha256)
    )
      throw new BenchError("Caso reservado inválido ou sem rastreabilidade.");

    if (
      canonicalHash({
        edition,
        version,
        reference,
        criteria,
        criticalError,
        sourceHashes: sourceIds.map((source: string) => sources[source].provenanceSha256),
      }) !== referenceSha256
    )
      throw new BenchError(`Hash da referência divergente em ${id}.`);

    const normalized = question.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
    if (questions.has(normalized)) throw new BenchError("Pergunta duplicada na bateria reservada.");
    questions.add(normalized);
    ids.add(id);
    const group = `${category}/${edition}/${difficulty}`;
    groups.set(group, (groups.get(group) ?? 0) + 1);
    return {
      id,
      category,
      edition,
      version,
      difficulty,
      question,
      reference,
      rubric: criteria,
      criticalError,
      sourceIds,
      referenceSha256,
      requiresClarification,
    };
  });

  if (groups.size !== 36 || [...groups.values()].some((count) => count !== 2)) {
    throw new BenchError("Distribuição da bateria reservada inválida.");
  }
  return { cases, sources };
}

export async function loadReservedSuite(directory: string) {
  const root = await privateDirectory(directory);
  const bytes = await readPrivateFile(join(root, RESERVED_NAME), 256 * 1024);
  if (sha256(bytes) !== RESERVED_SHA256)
    throw new BenchError("SHA-256 da bateria reservada divergente.");
  return { root, ...parseReservedSuite(parsePrivateJSON(bytes)) };
}
