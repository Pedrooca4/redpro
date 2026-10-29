import test from "node:test";
import assert from "node:assert/strict";
import { newRecordId, parseRecordId, toUtcTimestamp } from "../src/db/record-policy.ts";

test("record identifiers use random UUID v4 and normalize canonical UUID input", () => {
  const ids = Array.from({ length: 256 }, () => newRecordId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(parseRecordId(id.toUpperCase()), id);
  assert.equal(
    parseRecordId("C301FC1A-44F5-4140-B786-4965AF4A1DAD"),
    "c301fc1a-44f5-4140-b786-4965af4a1dad",
  );
});

test("record identifier validation rejects sequential, malformed and other-version input", () => {
  for (const value of [
    undefined,
    null,
    123,
    {},
    "1",
    "",
    "00000000-0000-0000-0000-000000000000",
    "c301fc1a-44f5-1140-b786-4965af4a1dad",
    "c301fc1a-44f5-4140-7786-4965af4a1dad",
    " c301fc1a-44f5-4140-b786-4965af4a1dad",
    "'; drop table profiles; --",
  ]) {
    assert.throws(() => parseRecordId(value), { message: "Invalid record identifier" });
  }
});

test("timestamps serialize the same instant as UTC with millisecond precision", () => {
  assert.equal(
    toUtcTimestamp(new Date("2026-10-29T12:30:00.123-03:00")),
    "2026-10-29T15:30:00.123Z",
  );
  assert.equal(toUtcTimestamp(new Date("2026-10-30T00:15:00+05:30")), "2026-10-29T18:45:00.000Z");
  assert.equal(toUtcTimestamp(new Date("2024-02-29T23:59:59.999Z")), "2024-02-29T23:59:59.999Z");
});

test("timestamp boundary rejects invalid, timezone-less and unsupported values without echoing input", () => {
  const inputs: unknown[] = [
    new Date(NaN),
    new Date("+010000-01-01T00:00:00Z"),
    new Date("0000-01-01T00:00:00Z"),
    "2026-10-29T12:00:00",
    "private-input",
    null,
    0,
    {},
  ];
  for (const input of inputs)
    assert.throws(() => toUtcTimestamp(input as Date), { message: "Invalid timestamp" });
});
