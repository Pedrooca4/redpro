import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Check versioning policy, never read local env files or print variable values.
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const trackedEnvs = tracked.filter((path) => path.split("/").at(-1).startsWith(".env"));
assert.deepEqual(trackedEnvs, [".env.example"], "Only the root empty .env.example may be tracked");

const expected = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SMOKE_BASE_URL",
];
const names = [];
for (const line of readFileSync(".env.example", "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const match = /^([A-Z][A-Z0-9_]*)=$/.exec(line);
  assert.ok(match, "Example assignments must have empty values and valid names");
  names.push(match[1]);
}
assert.deepEqual(names, expected, "The environment example must match the documented inventory");

const probes = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
  ".env.local.bak",
  "src/.env.local",
  ".vercel/.env.production.local",
];
const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
  input: probes.join("\n") + "\n",
  encoding: "utf8",
})
  .trim()
  .split(/\r?\n/);
assert.deepEqual(ignored, probes, "Local environment files must be ignored");
console.log("PASS env policy: only empty template tracked; local env paths ignored");
console.log("No private environment files were read. This check is not a general secret scanner.");
