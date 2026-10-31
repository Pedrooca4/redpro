import test from "node:test";
import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import { spawnSync } from "node:child_process";
import {
  INSPECTION_ENVIRONMENT,
  checkInspectionGate,
  validateInspectionInvocation,
  validateInspectionProtection,
  validateInspectionRepository,
  validateInspectionCI,
} from "../scripts/db-inspect-gate.ts";
import {
  DEVELOPMENT_TARGET,
  EXPECTED_MIGRATIONS,
  INSPECTION_COMMANDS,
  inspectSafeOutput,
  validateInspectionCA,
  validateInspectionConnection,
} from "../scripts/db-inspect.ts";
import { developmentPoolConfig } from "../src/db/connection.ts";
import { readDevelopmentDatabaseConfig } from "../src/config/database.ts";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const invocation = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "Pedrooca4/redpro",
  GITHUB_REPOSITORY_ID: "1436162515",
  GITHUB_ACTOR: "Pedrooca4",
  GITHUB_TRIGGERING_ACTOR: "Pedrooca4",
  EXPECTED_SHA: sha,
  GITHUB_SHA: sha,
  GH_TOKEN: "synthetic-token-never-log",
};
const repository = {
  id: 1436162515,
  full_name: "Pedrooca4/redpro",
  private: true,
  default_branch: "main",
  owner: { id: 289236254 },
};
const main = { commit: { sha } };
const protection = {
  name: INSPECTION_ENVIRONMENT,
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [
    {
      type: "required_reviewers",
      prevent_self_review: false,
      reviewers: [{ type: "User", reviewer: { login: "Pedrooca4", id: 289236254 } }],
    },
  ],
};
const policies = { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
const runs = {
  workflow_runs: [
    {
      id: 123,
      head_sha: sha,
      head_branch: "main",
      event: "push",
      path: ".github/workflows/ci.yml",
      status: "completed",
      conclusion: "success",
    },
  ],
};
const jobs = {
  total_count: 2,
  jobs: ["Quality and production smoke", "Disposable PostgreSQL migrations"].map((name) => ({
    name,
    run_id: 123,
    status: "completed",
    conclusion: "success",
  })),
};
const remote = {
  DATABASE_URL: `postgresql://postgres.${DEVELOPMENT_TARGET}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`,
  REDPRO_DB_PASSWORD: "synthetic-private-password",
  REDPRO_DB_ENV: "development",
  REDPRO_DB_TARGET_REF: DEVELOPMENT_TARGET,
};
const target = {
  event: "database.target",
  provider: "supabase",
  environment: "development",
  target: DEVELOPMENT_TARGET,
  fingerprint,
  connected: false,
};
const connected = {
  event: "database.connected",
  provider: "supabase",
  environment: "development",
  target: DEVELOPMENT_TARGET,
  fingerprint,
  readOnly: true,
  tlsVerified: true,
  postgresMajor: 17,
};
const migrations = {
  event: "database.migrations",
  migrations: EXPECTED_MIGRATIONS.map((name) => ({ name, applied: false })),
};

test("inspection requires an owner-triggered dispatch at the exact approved main SHA", () => {
  assert.equal(validateInspectionInvocation(invocation), sha);
  for (const override of [
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/main" },
    { GITHUB_REPOSITORY: "another/repo" },
    { GITHUB_REPOSITORY_ID: "1" },
    { GITHUB_ACTOR: "other" },
    { GITHUB_TRIGGERING_ACTOR: "other" },
    { EXPECTED_SHA: "abc" },
    { EXPECTED_SHA: "c".repeat(40) },
    { RUNNER_DEBUG: "1" },
    { ACTIONS_STEP_DEBUG: "true" },
  ])
    assert.throws(
      () => validateInspectionInvocation({ ...invocation, ...override }),
      /GATE_REFUSED/,
    );
});

test("environment must have owner approval, no administrator bypass and only the main branch", () => {
  assert.doesNotThrow(() => validateInspectionProtection(protection, policies));
  for (const env of [
    {},
    { ...protection, can_admins_bypass: true },
    { ...protection, protection_rules: [] },
    { ...protection, deployment_branch_policy: null },
    { ...protection, protection_rules: [{ ...protection.protection_rules[0], reviewers: [] }] },
    {
      ...protection,
      protection_rules: [{ ...protection.protection_rules[0], prevent_self_review: true }],
    },
    {
      ...protection,
      protection_rules: [
        {
          ...protection.protection_rules[0],
          reviewers: [{ type: "Team", reviewer: { id: 289236254, login: "Pedrooca4" } }],
        },
      ],
    },
  ])
    assert.throws(() => validateInspectionProtection(env, policies), /GATE_REFUSED/);
  for (const p of [
    { ...policies, total_count: 2 },
    { total_count: 1, branch_policies: [{ name: "*", type: "branch" }] },
    { total_count: 1, branch_policies: [{ name: "main", type: "tag" }] },
  ])
    assert.throws(() => validateInspectionProtection(protection, p), /GATE_REFUSED/);
});

test("private repository and current main identity are mandatory", () => {
  assert.doesNotThrow(() => validateInspectionRepository(repository, main, sha));
  for (const override of [
    { private: false },
    { id: 1 },
    { default_branch: "other" },
    { owner: { id: 1 } },
  ])
    assert.throws(() => validateInspectionRepository({ ...repository, ...override }, main, sha));
  assert.throws(() =>
    validateInspectionRepository(repository, { commit: { sha: "c".repeat(40) } }, sha),
  );
});

test("only completed successful main CI with both required jobs permits inspection", () => {
  assert.doesNotThrow(() => validateInspectionCI(runs, jobs, sha));
  for (const override of [
    { conclusion: "failure" },
    { status: "in_progress" },
    { event: "pull_request" },
    { head_sha: "c".repeat(40) },
    { path: ".github/workflows/other.yml" },
  ])
    assert.throws(() =>
      validateInspectionCI(
        { workflow_runs: [{ ...runs.workflow_runs[0], ...override }] },
        jobs,
        sha,
      ),
    );
  for (const conclusion of ["failure", "skipped", "cancelled", null])
    assert.throws(() =>
      validateInspectionCI(
        runs,
        { ...jobs, jobs: [{ ...jobs.jobs[0], conclusion }, jobs.jobs[1]] },
        sha,
      ),
    );
  assert.throws(() => validateInspectionCI(runs, { total_count: 1, jobs: [jobs.jobs[0]] }, sha));
  assert.throws(() =>
    validateInspectionCI(runs, { ...jobs, jobs: [jobs.jobs[0], jobs.jobs[0]] }, sha),
  );
});

test("gate uses only authenticated fixed-origin GET metadata and refuses unavailable protections", async () => {
  const responses = [repository, main, protection, policies, runs, jobs];
  let count = 0;
  const request: typeof fetch = async (input, init) => {
    assert.ok(String(input).startsWith("https://api.github.com/repos/Pedrooca4/redpro"));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      `Bearer ${invocation.GH_TOKEN}`,
    );
    return Response.json(responses[count++]);
  };
  const result = await checkInspectionGate(invocation, request);
  assert.equal(count, 6);
  assert.equal(result.sha, sha);
  assert.ok(!JSON.stringify(result).includes("synthetic"));
  for (const status of [403, 404, 500]) {
    let calls = 0;
    await assert.rejects(
      checkInspectionGate(invocation, async () => {
        calls++;
        return new Response("synthetic-private-message", { status });
      }),
      /GATE_REFUSED/,
    );
    assert.equal(calls, 1);
  }
});

test("inspection pins only the authorized Supabase project, password source, port and TLS", () => {
  const config = validateInspectionConnection(remote);
  assert.equal(config.target, DEVELOPMENT_TARGET);
  assert.deepEqual(developmentPoolConfig(config, { readOnly: true }).ssl, {
    rejectUnauthorized: true,
  });
  assert.match(
    developmentPoolConfig(config, { readOnly: true }).options!,
    /default_transaction_read_only=on/,
  );
  for (const override of [
    { REDPRO_DB_TARGET_REF: "abcdefghijklmnopqrst" },
    { REDPRO_DB_PASSWORD: "" },
    { DATABASE_URL: remote.DATABASE_URL.replace(":5432", ":6543") },
    { DATABASE_URL: remote.DATABASE_URL.replace("@", ":synthetic-password@") },
    { DATABASE_URL: remote.DATABASE_URL + "?sslmode=disable" },
    { REDPRO_DB_ENV: "test" },
    { VERCEL: "1" },
    { NODE_ENV: "production" },
    { RUNNER_DEBUG: "1" },
  ])
    assert.throws(() => validateInspectionConnection({ ...remote, ...override }));
  const local = readDevelopmentDatabaseConfig({
    DATABASE_URL: "postgresql://test:synthetic@127.0.0.1/redpro_test",
    REDPRO_DB_ENV: "test",
    REDPRO_DB_TARGET_REF: "local-test",
  });
  assert.equal(
    developmentPoolConfig(local).options,
    "-c timezone=UTC",
    "Migration connections remain writable by default",
  );
});

test("only public CA certificates are accepted, never private keys or arbitrary paths", () => {
  assert.equal(validateInspectionCA(rootCertificates[0]), rootCertificates[0]);
  for (const value of [
    undefined,
    "",
    "/some/file",
    "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----",
    "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
    "x".repeat(20_000),
  ])
    assert.throws(() => validateInspectionCA(value));
});

test("captured command output has a strict allowlist and the six historical migrations", () => {
  assert.deepEqual(INSPECTION_COMMANDS, ["target", "check", "status"]);
  assert.deepEqual(inspectSafeOutput("target", JSON.stringify(target), fingerprint), [target]);
  assert.deepEqual(inspectSafeOutput("check", JSON.stringify(connected), fingerprint), [connected]);
  assert.deepEqual(
    inspectSafeOutput(
      "status",
      [connected, migrations].map((v) => JSON.stringify(v)).join("\n"),
      fingerprint,
    ),
    [connected, migrations],
  );
  for (const output of [
    "synthetic-private-message",
    JSON.stringify({ ...connected, password: "synthetic-private-password" }),
    JSON.stringify({ ...connected, tlsVerified: false }),
    JSON.stringify({ ...connected, target: "another" }),
    JSON.stringify({ ...connected, readOnly: false }),
    "x".repeat(40_000),
  ])
    assert.throws(() => inspectSafeOutput("check", output, fingerprint));
  const invalid = structuredClone(migrations);
  invalid.migrations[1]!.applied = true;
  assert.throws(() =>
    inspectSafeOutput(
      "status",
      [connected, invalid].map((v) => JSON.stringify(v)).join("\n"),
      fingerprint,
    ),
  );
  assert.throws(() =>
    inspectSafeOutput(
      "status",
      [connected, { ...migrations, migrations: [] }].map((v) => JSON.stringify(v)).join("\n"),
      fingerprint,
    ),
  );
});

test("invalid inspection configuration exits safely before connection without exposing child errors", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/db-inspect.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL: "synthetic-private-invalid-url",
        REDPRO_DB_PASSWORD: "synthetic-private-password",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    event: "database.failed",
    code: "DB_SAFETY_REFUSED",
  });
  assert.ok(!result.stderr.includes("synthetic-private"));
});
