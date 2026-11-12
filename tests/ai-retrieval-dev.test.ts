import assert from "node:assert/strict";
import test from "node:test";

import { createKnowledgeSearch } from "../scripts/ai-bench/knowledge.ts";
import { searchWithContext } from "../scripts/ai-retrieval-dev/context.ts";
import { evaluateRetrieval, loadDevelopment } from "../scripts/ai-retrieval-dev/evaluate.ts";

test("separa evidência, contexto ausente e lacunas nos 44 casos novos", async () => {
  const { cards, baseline, context, proposed, improved, regressed, legacy } =
    await evaluateRetrieval();
  assert.equal(cards.baseline, 23);
  assert.equal(cards.candidate, 7);
  assert.equal(proposed.total.total, 44);
  assert.equal(proposed.total.evidenceCases, 28);
  assert.equal(baseline.total.evidenceCorrect, 14);
  assert.equal(context.total.evidenceCorrect, 14);
  assert.equal(proposed.total.evidenceCorrect, 26);
  assert.equal(proposed.total.sourcesCorrect, 27);
  assert.equal(proposed.total.onlyRelevantCards, 25);
  assert.equal(proposed.total.clarified, 8);
  assert.equal(proposed.total.unexpectedClarification, 0);
  assert.equal(improved.length, 20);
  assert.deepEqual(regressed, []);
  assert.equal(legacy.length, 21);
  assert.ok(
    legacy.every(
      ({ expected, original, proposed }) => expected === original && original === proposed,
    ),
  );

  const rows = new Map(proposed.rows.map((row) => [row.id, row]));
  for (const id of ["R07", "R34", "R35"]) {
    assert.equal(rows.get(id)?.status, "unverified-context");
  }
  assert.deepEqual(rows.get("R22")?.retrieved, []);
  assert.deepEqual(rows.get("R25")?.retrieved, []);
  assert.deepEqual(rows.get("R43")?.unrelated, ["MP-repeater-direction"]);
  assert.equal(rows.get("R44")?.retrieved[0].id, "MP-repeater-direction");
  assert.equal(rows.get("R44")?.sourcesCorrect, true);
  assert.equal(rows.get("R44")?.correct, false);
});

test("detecta contextos em conflito sem bloquear menção à origem de um projeto", async () => {
  const { base } = await loadDevelopment();
  const search = createKnowledgeSearch(base);
  const query = { edition: "Bedrock", version: "1.21.80" } as const;
  assert.deepEqual(
    searchWithContext(search, {
      ...query,
      question: "No Java 1.21.5, e na edição Java, a quase-conectividade funciona?",
    }),
    { clarification: ["edition", "version"] },
  );
  assert.deepEqual(
    searchWithContext(search, {
      ...query,
      question: "A quase-conectividade mudou entre Bedrock 1.21.80 e Java 1.21.5?",
    }),
    { clarification: ["edition", "version"] },
  );
  assert.deepEqual(
    searchWithContext(search, {
      question: "Como oriento meu repetidor?",
      edition: null,
      version: null,
    }),
    { clarification: ["edition", "version"] },
  );
  const response = searchWithContext(search, {
    ...query,
    question: "Meu projeto veio do Java. No Bedrock, a quasi-conectividade funciona?",
  });
  assert.equal(response.retrieval?.cards[0].id, "MP-quasi");
});
