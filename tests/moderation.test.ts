import test from "node:test";
import assert from "node:assert/strict";
import { parseReportTarget, parseReportReason } from "../src/db/moderation.ts";
import { newRecordId } from "../src/db/record-policy.ts";

test("report target is exactly one supported resource with a canonical UUID v4", () => {
  const id = newRecordId();
  for (const kind of ["post", "comment"])
    assert.deepEqual(parseReportTarget({ kind, id: id.toUpperCase() }), { kind, id });
  for (const target of [
    null,
    [],
    {},
    "private-input",
    { kind: "project", id },
    { kind: "post" },
    { kind: "post", id: "019535d9-3df7-79fb-b466-fa907fa17f9e" },
    { kind: "post", id, comment_id: id },
  ])
    assert.throws(() => parseReportTarget(target), TypeError);
});

test("report reason is bounded text, normalized without logging private input", () => {
  assert.equal(parseReportReason("  Conteúdo inadequado  "), "Conteúdo inadequado");
  assert.equal(parseReportReason("🚩".repeat(160)), "🚩".repeat(160));
  for (const value of [null, undefined, 3, {}, "", "\n\t ", "x".repeat(161)])
    assert.throws(() => parseReportReason(value), {
      name: "TypeError",
      message: "Invalid report reason",
    });
});
