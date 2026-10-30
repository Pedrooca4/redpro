import test from "node:test";
import assert from "node:assert/strict";
import { parseReactionKind, parseFavoriteTarget } from "../src/db/community.ts";
import { newRecordId } from "../src/db/record-policy.ts";

test("community reactions accept the supported like without inventing moderation powers", () => {
  assert.equal(parseReactionKind("like"), "like");
  for (const value of ["admin", "LIKE", "tested", "", null, undefined, 1, {}])
    assert.throws(() => parseReactionKind(value), TypeError);
});

test("favorite targets have one typed resource and a MinePRO UUID v4", () => {
  const id = newRecordId();
  for (const kind of ["post", "project"])
    assert.deepEqual(parseFavoriteTarget({ kind, id: id.toUpperCase() }), { kind, id });
  for (const value of [
    null,
    [],
    {},
    "private-input",
    { kind: "profile", id },
    { kind: "post" },
    { kind: "post", id: "019535d9-3df7-79fb-b466-fa907fa17f9e" },
    { kind: "post", id, project_id: id },
  ])
    assert.throws(() => parseFavoriteTarget(value), TypeError);
});
