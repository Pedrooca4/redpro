import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRetrieval, loadDevelopment } from "../scripts/ai-retrieval-dev/evaluate.ts";

test("mantém a nova bateria fechada e as expectativas das 21 consultas antigas", async () => {
  const [previous, current, report] = await Promise.all([
    loadDevelopment(),
    loadDevelopment("3fb"),
    evaluateRetrieval("3fb"),
  ]);
  assert.equal(current.queries.length, 42);
  assert.equal(report.sha256, current.sha256);
  const previousQuestions = new Set(previous.queries.map(({ question }) => question));
  assert.equal(new Set(current.queries.map(({ question }) => question)).size, 42);
  assert.ok(current.queries.every(({ question }) => !previousQuestions.has(question)));
  assert.equal(report.legacy.length, 21);
  assert.ok(
    report.legacy.every(
      ({ expected, original, proposed }) => expected === original && original === proposed,
    ),
  );
});

test("reproduz ganhos, limites e regressões sem reordenar as fichas", async () => {
  const { baseline, context, proposed, improved, regressed } = await evaluateRetrieval("3fb");
  assert.equal(proposed.total.evidenceCases, 22);
  assert.deepEqual(
    [baseline, context, proposed].map(({ total }) => [
      total.evidenceCorrect,
      total.relevantTop,
      total.sourcesCorrect,
      total.adequateAbstentions,
      total.clarified,
    ]),
    [
      [9, 11, 9, 7, 0],
      [9, 11, 9, 7, 6],
      [14, 15, 17, 7, 6],
    ],
  );
  assert.equal(improved.length, 13);
  assert.deepEqual(regressed, ["B04", "B05"]);
  assert.equal(proposed.total.unexpectedClarification, 0);
  assert.equal(proposed.byExpectation["clarify-detail"].clarified, 0);

  const rows = new Map(proposed.rows.map((row) => [row.id, row]));
  assert.deepEqual(
    rows.get("B03")?.retrieved.map(({ id }) => id),
    ["MP-repeater-direction", "MP-dev-bulb-bedrock"],
  );
  assert.equal(rows.get("B04")?.retrieved[0].id, "MP-dev-bulb-java");
  assert.equal(rows.get("B05")?.retrieved[0].id, "MP-dev-bulb-bedrock");
  assert.equal(rows.get("B08")?.relevantTop, true);
  assert.equal(rows.get("B08")?.sourcesCorrect, false);
  assert.equal(rows.get("B20")?.status, "unverified-context");
  assert.deepEqual(rows.get("B21")?.retrieved, []);
  assert.deepEqual(rows.get("B22")?.retrieved, []);
  assert.deepEqual(rows.get("B42")?.fields, ["version"]);
});
