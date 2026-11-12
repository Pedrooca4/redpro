import type { Retrieval } from "../ai-bench/knowledge.ts";

export type Query = {
  question: string;
  edition: "Java" | "Bedrock" | null;
  version: string | null;
};
type Search = (query: Query) => Retrieval;
export type ContextField = "edition" | "version";

export function searchWithContext(search: Search, query: Query) {
  const { question, edition, version } = query;
  const text = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const editions = new Set(
    [
      ...text.matchAll(
        /\b(?:(?:no|na|em|edicao|entre)\s+(java|bedrock)\b|(java|bedrock)\s+(?=\d{1,3}\.\d{1,3}\.\d{1,3}\b))/gu,
      ),
    ].map(([, target, versioned]) => target ?? versioned),
  );
  const versions = new Set(
    [...text.matchAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\b/gu)].map((match) => match[0]),
  );
  const fields: ContextField[] = [];
  // A comparison needs a separate lookup for each target. An edition mentioned
  // only as the source of a build (e.g. "veio do Java") is not a lookup target.
  if (!edition || [...editions].some((mentioned) => mentioned !== edition.toLowerCase())) {
    fields.push("edition");
  }
  if (!version || [...versions].some((mentioned) => mentioned !== version)) {
    fields.push("version");
  }
  return fields.length ? { clarification: fields } : { retrieval: search(query) };
}
