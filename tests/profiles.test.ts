import test from "node:test";
import assert from "node:assert/strict";
import { parseAuthUserId } from "../src/db/profiles.ts";

test("profiles preserve Auth UUID identity without generating or imposing a version", () => {
  for (const id of ["C301FC1A-44F5-4140-B786-4965AF4A1DAD", "019535D9-3DF7-79FB-B466-FA907FA17F9E"])
    assert.equal(parseAuthUserId(id), id.toLowerCase());
});

test("profiles reject malformed external identities without echoing private input", () => {
  for (const id of [
    undefined,
    null,
    1,
    {},
    "private-input",
    "123",
    "c301fc1a44f54140b7864965af4a1dad",
    " c301fc1a-44f5-4140-b786-4965af4a1dad",
  ])
    assert.throws(() => parseAuthUserId(id), { message: "Invalid Auth user identifier" });
});
