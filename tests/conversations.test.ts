import test from "node:test";
import assert from "node:assert/strict";
import { parseMessageRole, parseMessageSequence } from "../src/db/conversations.ts";

test("message order is a positive PostgreSQL integer, not an ID or timestamp", () => {
  for (const value of [1, 2, 2147483647]) assert.equal(parseMessageSequence(value), value);
  for (const value of [0, -1, 1.5, 2147483648, NaN, Infinity, "1", null, undefined, {}])
    assert.throws(() => parseMessageSequence(value), { message: "Invalid message sequence" });
});

test("message role parser accepts storage roles without granting client permissions", () => {
  for (const role of ["user", "assistant", "system", "tool"])
    assert.equal(parseMessageRole(role), role);
  for (const role of ["admin", "developer", "USER", "", null, {}, "private-content"])
    assert.throws(() => parseMessageRole(role), { message: "Invalid message role" });
});
