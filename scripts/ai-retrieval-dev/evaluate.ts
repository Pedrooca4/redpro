import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createKnowledgeSearch, type Retrieval } from "../ai-bench/knowledge.ts";
import { searchWithContext, type ContextField, type Query } from "./context.ts";

const fixtures = {
  "3fa": "./cases.json",
  "3fb": "./cases-3fb.json",
} as const;
type Suite = keyof typeof fixtures;
type SourceLinks = Record<string, { url: string }>;
const PHASE_3FB_SHA256 = "ec95340e3cd44bed598b82d98a8c896f30ffc7f13985776807589df9faa585c8";

type Card = {
  id: string;
  topic: string;
  versions: Partial<Record<NonNullable<Query["edition"]>, string[]>>;
  sourceIds: string[];
};
type Corpus = {
  schemaVersion: number;
  purpose: string;
  sources: SourceLinks;
  cards: Card[];
};
type Expectation =
  "evidence" | "absent" | "incompatible" | "insufficient" | "clarify" | "clarify-detail";
type Evidence = { card: string; sources: string[] };
type Example = Query & {
  id: string;
  topic: string;
  expected: Expectation;
  evidence?: Evidence[];
  relatedCards?: string[];
  fields?: ContextField[];
  reference?: string;
  criterion?: string;
};

const read = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as T;

export async function loadDevelopment(suite: Suite = "3fa") {
  const [base, candidates, fixtureBytes, regression] = await Promise.all([
    read<Corpus>("../ai-bench/knowledge.json"),
    read<Corpus>("./candidates.json"),
    readFile(new URL(fixtures[suite], import.meta.url)),
    read<{ queries: (Query & { id: string; expectedTop: string | null })[] }>(
      "../ai-bench/retrieval-dev.json",
    ),
  ]);
  const sha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  if (suite === "3fb" && sha256 !== PHASE_3FB_SHA256) {
    throw new Error("As perguntas ou os critérios da Fase 3F-B foram alterados.");
  }
  const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
    schemaVersion: number;
    purpose: string;
    queries: Example[];
    references?: SourceLinks;
  };
  if (
    fixture.schemaVersion !== 1 ||
    fixture.purpose !== "retrieval-development-only" ||
    candidates.purpose !== "retrieval-development-candidates"
  ) {
    throw new Error("A auditoria só aceita os conjuntos de desenvolvimento deste diretório.");
  }
  if (Object.keys(candidates.sources).some((id) => Object.hasOwn(base.sources, id))) {
    throw new Error("Uma fonte candidata reutiliza um ID congelado.");
  }
  const expanded = {
    ...base,
    sources: { ...base.sources, ...candidates.sources },
    cards: [...base.cards, ...candidates.cards],
  };
  const referenceOnly = fixture.references ?? {};
  for (const [id, { url }] of Object.entries(referenceOnly)) {
    if (Object.hasOwn(expanded.sources, id) || new URL(url).protocol !== "https:") {
      throw new Error(`Referência externa inválida: ${id}`);
    }
  }
  const references = { ...expanded.sources, ...referenceOnly };
  const catalog = new Map(expanded.cards.map((card) => [card.id, card]));
  const ids = new Set<string>();
  for (const example of fixture.queries) {
    if (ids.has(example.id)) throw new Error(`Consulta duplicada: ${example.id}`);
    ids.add(example.id);
    if (example.expected === "clarify" && !example.fields?.length) {
      throw new Error(`Faltam campos esperados para ${example.id}`);
    }
    if (example.expected === "evidence" && !example.evidence?.length) {
      throw new Error(`Falta referência para ${example.id}`);
    }
    for (const evidence of example.evidence ?? []) {
      const card = catalog.get(evidence.card);
      if (
        !card ||
        !example.edition ||
        !example.version ||
        !card.versions[example.edition]?.includes(example.version) ||
        !evidence.sources.length ||
        evidence.sources.some((id) => !card.sourceIds.includes(id))
      ) {
        throw new Error(`Evidência incompatível em ${example.id}: ${evidence.card}`);
      }
    }
    if (
      example.relatedCards?.some((id) => !catalog.has(id)) ||
      (example.reference && !Object.hasOwn(references, example.reference))
    ) {
      throw new Error(`Referência desconhecida em ${example.id}`);
    }
  }
  return { base, candidates, expanded, regression, queries: fixture.queries, references, sha256 };
}

function assess(
  example: Example,
  corpus: Corpus,
  search: ReturnType<typeof createKnowledgeSearch>,
  guard: boolean,
  references: SourceLinks,
) {
  const response: { retrieval?: Retrieval; clarification?: ContextField[] } = guard
    ? searchWithContext(search, example)
    : example.edition
      ? { retrieval: search(example) }
      : {};
  const retrieved = (response.retrieval?.cards ?? []).map(({ id, score }) => {
    const card = corpus.cards.find((entry) => entry.id === id);
    if (!card) throw new Error(`Ficha recuperada fora do catálogo: ${id}`);
    const versions = example.edition ? card.versions[example.edition] : undefined;
    return {
      id,
      score,
      sourceIds: card.sourceIds,
      urls: card.sourceIds.map((source) => corpus.sources[source].url),
      edition: !!versions,
      version: !!example.version && !!versions?.includes(example.version),
    };
  });
  const evidence = example.evidence ?? [];
  const relevant = evidence.map((item) => retrieved.find((card) => card.id === item.card));
  const relevantTop = evidence.some((item) => item.card === retrieved[0]?.id);
  const allRelevant = evidence.length > 0 && relevant.every(Boolean);
  const sourcesCorrect =
    allRelevant &&
    evidence.every((item, index) =>
      item.sources.every((source) => relevant[index]?.sourceIds.includes(source)),
    );
  const extra = retrieved.filter((card) => !evidence.some((item) => item.card === card.id));
  const unrelated = extra.filter((card) => !example.relatedCards?.includes(card.id));
  const correct =
    example.expected === "evidence"
      ? sourcesCorrect && relevantTop && retrieved.every((card) => card.edition && card.version)
      : example.expected === "clarify"
        ? JSON.stringify(response.clarification) === JSON.stringify(example.fields)
        : example.expected === "clarify-detail"
          ? false
          : !retrieved.length;
  return {
    id: example.id,
    topic: example.topic,
    question: example.question,
    edition: example.edition,
    version: example.version,
    expected: example.expected,
    references: (example.reference
      ? [example.reference]
      : evidence.flatMap(({ sources }) => sources)
    ).map((id) => ({ id, url: references[id].url })),
    criterion: example.criterion ?? null,
    expectedFields: example.fields ?? [],
    reason: response.clarification
      ? "clarification"
      : (response.retrieval?.reason ?? "missing-edition"),
    fields: response.clarification ?? [],
    retrieved,
    relevantTop,
    allRelevant,
    sourcesCorrect,
    unrelated: unrelated.map((card) => card.id),
    correct,
    status: response.clarification
      ? "clarification"
      : !retrieved.length
        ? "no-evidence"
        : sourcesCorrect && relevantTop
          ? "evidence"
          : "unverified-context",
  };
}

type Row = ReturnType<typeof assess>;

function totals(rows: Row[]) {
  const count = (predicate: (row: Row) => boolean) => rows.filter(predicate).length;
  return {
    total: rows.length,
    correct: count((row) => row.correct),
    evidenceCases: count((row) => row.expected === "evidence"),
    evidenceCorrect: count((row) => row.expected === "evidence" && row.correct),
    covered: count((row) => row.retrieved.length > 0),
    abstentions: count((row) => row.status === "no-evidence"),
    adequateAbstentions: count((row) => row.status === "no-evidence" && row.correct),
    clarifications: count((row) => row.status === "clarification"),
    relevantTop: count((row) => row.relevantTop),
    allRelevant: count((row) => row.allRelevant),
    sourcesCorrect: count((row) => row.sourcesCorrect),
    compatibleEdition: count(
      (row) => row.retrieved.length > 0 && row.retrieved.every((card) => card.edition),
    ),
    compatibleVersion: count(
      (row) => row.retrieved.length > 0 && row.retrieved.every((card) => card.version),
    ),
    unrelatedContext: count((row) => row.unrelated.length > 0),
    onlyRelevantCards: count(
      (row) => row.expected === "evidence" && row.correct && row.unrelated.length === 0,
    ),
    needsClarification: count((row) => row.expected.startsWith("clarify")),
    clarified: count((row) => row.expected.startsWith("clarify") && row.correct),
    unexpectedClarification: count(
      (row) => row.reason === "clarification" && !row.expected.startsWith("clarify"),
    ),
  };
}

function summarize(rows: Row[]) {
  const group = (key: (row: Row) => string) =>
    Object.fromEntries(
      [...new Set(rows.map(key))].map((value) => [
        value,
        totals(rows.filter((row) => key(row) === value)),
      ]),
    );
  return {
    total: totals(rows),
    byTopic: group((row) => row.topic),
    byEdition: group((row) => row.edition ?? "sem edição"),
    byVersion: group((row) => `${row.edition ?? "sem edição"} ${row.version ?? "sem versão"}`),
    byExpectation: group((row) => row.expected),
    rows,
  };
}

export async function evaluateRetrieval(suite: Suite = "3fa") {
  const { base, candidates, expanded, queries, regression, references, sha256 } =
    await loadDevelopment(suite);
  const baseSearch = createKnowledgeSearch(base);
  const expandedSearch = createKnowledgeSearch(expanded);
  const baseline = summarize(
    queries.map((query) => assess(query, base, baseSearch, false, references)),
  );
  const context = summarize(
    queries.map((query) => assess(query, base, baseSearch, true, references)),
  );
  const proposed = summarize(
    queries.map((query) => assess(query, expanded, expandedSearch, true, references)),
  );
  return {
    suite,
    sha256,
    cards: {
      baseline: base.cards.length,
      candidate: candidates.cards.length,
      frozenByTopic: Object.fromEntries(
        [...new Set(base.cards.map((card) => card.topic))].map((topic) => [
          topic,
          base.cards.filter((card) => card.topic === topic).length,
        ]),
      ),
    },
    baseline,
    context,
    proposed,
    improved: proposed.rows
      .filter((row, index) => row.correct && !baseline.rows[index].correct)
      .map(({ id }) => id),
    regressed: proposed.rows
      .filter((row, index) => !row.correct && baseline.rows[index].correct)
      .map(({ id }) => id),
    legacy: regression.queries.map((example) => {
      const original = baseSearch(example).cards[0]?.id ?? null;
      const response = searchWithContext(expandedSearch, example);
      return {
        id: example.id,
        expected: example.expectedTop,
        original,
        proposed: response.retrieval?.cards[0]?.id ?? null,
      };
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const suite = process.argv[2] ?? "3fa";
  if (suite !== "3fa" && suite !== "3fb") throw new Error("Use o conjunto 3fa ou 3fb.");
  process.stdout.write(`${JSON.stringify(await evaluateRetrieval(suite), null, 2)}\n`);
}
