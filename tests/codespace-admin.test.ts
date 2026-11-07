import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";
import {
  administrativeArguments,
  administrativeDatabaseConfig,
  readAdministrativeCa,
  verifyAdministrativeCheckout,
} from "../scripts/codespace-admin.ts";
import { DatabaseSafetyError } from "../src/config/database.ts";
import { developmentPoolConfig } from "../src/db/connection.ts";

const sha = "f".repeat(40);
const codespace = "minepro-disposable-test";
const ref = "rdwchjjxaipkufgxlnvh";
const direct = `db.${ref}.supabase.co`;
const session = "aws-0-us-east-1.pooler.supabase.com";
const args = [codespace, sha, direct, "test-ca.crt"];
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  CODESPACES: "true",
  CODESPACE_NAME: codespace,
  GITHUB_REPOSITORY: "Pedrooca4/redpro",
};

test("administrative arguments bind the authorized instance, repo, SHA and host", () => {
  assert.deepEqual(administrativeArguments(args, env), {
    sha,
    host: direct,
    caPath: "test-ca.crt",
  });
  assert.equal(administrativeArguments([codespace, sha, session, args[3]!], env).host, session);

  for (const candidate of [
    ["up", ...args],
    ["down", ...args],
    [...args, "--command=up"],
    ["another-space", ...args.slice(1)],
    [codespace, "main", ...args.slice(2)],
    [codespace, sha, "db.xrlqmbhpumsmuxksqbld.supabase.co", args[3]!],
    [codespace, sha, `${session}:6543`, args[3]!],
    [codespace, sha, `postgresql://postgres@${direct}/postgres`, args[3]!],
    [codespace, sha, `${direct}?sslmode=disable`, args[3]!],
  ])
    assert.throws(() => administrativeArguments(candidate, env), DatabaseSafetyError);
  for (const blocked of [
    { GITHUB_REPOSITORY: "other/redpro" },
    { NODE_ENV: "production" },
    { VERCEL: "1" },
    { GITHUB_ACTIONS: "true" },
    { DATABASE_URL: "synthetic" },
    { REDPRO_DB_PASSWORD: "synthetic" },
    { PGPASSWORD: "synthetic" },
    { PGSSLMODE: "disable" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { NODE_OPTIONS: "--inspect" },
    { SSLKEYLOGFILE: "synthetic" },
    { GIT_INDEX_FILE: "synthetic" },
  ])
    assert.throws(
      () =>
        administrativeArguments(args, {
          ...env,
          ...blocked,
          NODE_ENV: blocked.NODE_ENV === "production" ? "production" : "test",
        }),
      DatabaseSafetyError,
    );
});

test("administrative checkout rejects dirty, stale, detached and unrelated refs", () => {
  const output: Record<string, string> = {
    "symbolic-ref": "refs/heads/main",
    "rev-parse": sha,
    status: "",
    remote: "https://github.com/Pedrooca4/redpro.git",
    "ls-remote": `${sha}\trefs/heads/main`,
    "ls-files": "H package.json\0",
  };
  assert.doesNotThrow(() => verifyAdministrativeCheckout(sha, ([command]) => output[command!]!));
  for (const [command, unexpected] of [
    ["symbolic-ref", "refs/heads/codex/unreviewed"],
    ["rev-parse", "a".repeat(40)],
    ["status", "?? pending.txt"],
    ["remote", "https://github.com/other/redpro"],
    ["ls-remote", `${"a".repeat(40)}\trefs/heads/main`],
    ["ls-files", "S package.json\0"],
    ["ls-files", "h package.json\0"],
  ])
    assert.throws(
      () =>
        verifyAdministrativeCheckout(sha, ([name]) =>
          name === command ? unexpected! : output[name!]!,
        ),
      DatabaseSafetyError,
    );
});

test("administrative config uses the correct postgres identity and requires validated TLS", () => {
  for (const [host, user] of [
    [direct, "postgres"],
    [session, `postgres.${ref}`],
  ] as const) {
    const config = administrativeDatabaseConfig(
      host,
      "disposable-placeholder",
      "synthetic-public-ca",
    );
    const pool = developmentPoolConfig(config);
    assert.equal(config.target, ref);
    assert.equal(pool.host, host);
    assert.equal(pool.port, 5432);
    assert.equal(pool.database, "postgres");
    assert.equal(pool.user, user);
    assert.deepEqual(pool.ssl, { rejectUnauthorized: true, ca: "synthetic-public-ca" });
  }
  assert.throws(() => administrativeDatabaseConfig(direct, "", "ca"), DatabaseSafetyError);
  assert.throws(
    () => administrativeDatabaseConfig("127.0.0.1", "disposable", "ca"),
    DatabaseSafetyError,
  );
});

test("administrative CA rejects private material and malformed certificate files", () => {
  const dir = mkdtempSync(join(tmpdir(), "minepro-invalid-ca-"));
  try {
    const path = join(dir, "ca.crt");
    const publicCa = rootCertificates.find((pem) => {
      const cert = new X509Certificate(pem);
      const now = Date.now();
      return cert.ca && cert.validFromDate.getTime() < now && now < cert.validToDate.getTime();
    });
    assert.ok(publicCa);
    writeFileSync(path, publicCa);
    assert.equal(readAdministrativeCa(path), publicCa);
    writeFileSync(path, "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\n");
    assert.throws(() => readAdministrativeCa(path), DatabaseSafetyError);
    assert.throws(() => readAdministrativeCa(dir), DatabaseSafetyError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("administrative entrypoint refuses piped credentials and prints a fixed error", () => {
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/codespace-admin.ts", ...args],
    { env, input: "synthetic-never-log-this\n", encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), {
    event: "database.failed",
    code: "DB_SAFETY_REFUSED",
  });
});
