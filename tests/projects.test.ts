import test from "node:test";
import assert from "node:assert/strict";
import { parseProjectCount, parseAuthorDeclaredStatus } from "../src/db/projects.ts";

test("project quantities, dimensions and positions use positive discrete PostgreSQL integers", () => {
  for (const value of [1, 64, 2147483647]) assert.equal(parseProjectCount(value), value);
  for (const value of [0, -1, 1.5, 2147483648, NaN, Infinity, "64", null, undefined, {}])
    assert.throws(() => parseProjectCount(value), { message: "Invalid project count" });
});

test("author validation declarations accept only labels and confer no validation authority", () => {
  for (const value of ["draft", "illustrative", "reviewed", "tested"])
    assert.equal(parseAuthorDeclaredStatus(value), value);
  for (const value of ["admin", "moderator", "TESTED", "", null, {}, "private-content"])
    assert.throws(() => parseAuthorDeclaredStatus(value), {
      message: "Invalid author declaration",
    });
});
