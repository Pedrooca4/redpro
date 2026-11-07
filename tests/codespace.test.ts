import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { spawnSync } from "node:child_process";
import {
  LEDGER_READER_ROLE,
  readDevelopmentDatabaseConfig,
  readInspectionDatabaseConfig,
} from "../src/config/database.ts";
import { developmentPoolConfig } from "../src/db/connection.ts";
import { validateCodespaceConnection } from "../scripts/codespace-connection.ts";

const target = "rdwchjjxaipkufgxlnvh";
const direct = {
  DATABASE_URL: `postgresql://postgres@db.${target}.supabase.co:5432/postgres`,
  REDPRO_DB_PASSWORD: "synthetic-private-marker",
  REDPRO_DB_ENV: "development",
  REDPRO_DB_TARGET_REF: target,
};
const session = {
  ...direct,
  DATABASE_URL: `postgresql://postgres.${target}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`,
};
const sessionHost = "aws-1-us-east-2.pooler.supabase.com";

test("temporary authentication is explicit and direct access preserves TLS and target identity", () => {
  const normal = readDevelopmentDatabaseConfig(direct);
  const temporary = readDevelopmentDatabaseConfig({ ...direct, REDPRO_DB_AUTH_MODE: "temporary" });
  assert.equal(normal.authentication, "password");
  assert.equal(temporary.authentication, "temporary");
  assert.equal(
    normal.fingerprint,
    temporary.fingerprint,
    "Authentication mechanism is not another database target",
  );
  assert.equal(developmentPoolConfig(temporary).options, "-c timezone=UTC");
  assert.deepEqual(developmentPoolConfig(temporary).ssl, { rejectUnauthorized: true });
});

test("temporary Session pooler adds only the documented fixed startup flag", () => {
  const config = readDevelopmentDatabaseConfig({ ...session, REDPRO_DB_AUTH_MODE: "temporary" });
  const pool = developmentPoolConfig(config);
  assert.equal(pool.options, "-c timezone=UTC -c jit=on");
  assert.equal(pool.max, 1);
  assert.equal(pool.port, 5432);
  assert.deepEqual(pool.ssl, { rejectUnauthorized: true });
  assert.equal(
    developmentPoolConfig(readDevelopmentDatabaseConfig(session)).options,
    "-c timezone=UTC",
  );
});

test("authentication mode never accepts arbitrary options, production, local temporary mode or transaction poolers", () => {
  for (const override of [
    { REDPRO_DB_AUTH_MODE: "temporary -c ssl=off" },
    { REDPRO_DB_AUTH_MODE: "unknown" },
    { VERCEL: "1" },
    { NODE_ENV: "production" },
    { DATABASE_URL: session.DATABASE_URL.replace(":5432", ":6543") },
    { DATABASE_URL: session.DATABASE_URL + "?options=-c%20jit=on" },
    { DATABASE_URL: session.DATABASE_URL + "?sslmode=disable" },
    { DATABASE_URL: session.DATABASE_URL.replace(target, "abcdefghijklmnopqrst") },
  ])
    assert.throws(() =>
      readDevelopmentDatabaseConfig({ ...session, REDPRO_DB_AUTH_MODE: "temporary", ...override }),
    );
  assert.throws(() =>
    readDevelopmentDatabaseConfig({
      DATABASE_URL: "postgresql://test:synthetic@127.0.0.1/redpro_test",
      REDPRO_DB_ENV: "test",
      REDPRO_DB_TARGET_REF: "local-test",
      REDPRO_DB_AUTH_MODE: "temporary",
    }),
  );
});

test("private preflight accepts the fixed reader on the Session pooler with a public CA", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "minepro-public-ca-test-"));
  const ca = path.join(folder, "public.crt");
  const sha = "a".repeat(40);
  try {
    writeFileSync(ca, rootCertificates[0]!);
    const result = validateCodespaceConnection(sha, sessionHost, ca, "temporary");
    assert.equal(result.target, target);
    assert.equal(result.connected, false);
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(result).includes("synthetic"));
    assert.equal(
      validateCodespaceConnection(sha, sessionHost, ca, "password").authentication,
      "password",
    );
    for (const [s, host, mode] of [
      ["bad", sessionHost, "temporary"],
      [sha, `db.${target}.supabase.co`, "temporary"],
      [sha, "db.abcdefghijklmnopqrst.supabase.co", "temporary"],
      [sha, "127.0.0.1", "password"],
      [sha, "evil.example", "temporary"],
      [sha, `${sessionHost}:6543`, "temporary"],
      [sha, `bad@${sessionHost}`, "temporary"],
      [sha, sessionHost, "up"],
    ])
      assert.throws(() => validateCodespaceConnection(s!, host!, ca, mode!));
    writeFileSync(
      ca,
      "-----BEGIN PRIVATE KEY-----\nsynthetic-private-marker\n-----END PRIVATE KEY-----",
    );
    assert.throws(() => validateCodespaceConnection(sha, sessionHost, ca, "temporary"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("inspection configuration rejects another role, project, connection mode or missing CA", () => {
  const reader = {
    ...session,
    DATABASE_URL: session.DATABASE_URL.replace("postgres.", `${LEDGER_READER_ROLE}.`),
    REDPRO_DB_SSL_CA_FILE: "public.crt",
  };
  assert.equal(readInspectionDatabaseConfig(reader).user, `${LEDGER_READER_ROLE}.${target}`);
  for (const env of [
    { ...reader, DATABASE_URL: session.DATABASE_URL },
    { ...reader, DATABASE_URL: reader.DATABASE_URL.replace(LEDGER_READER_ROLE, "another_role") },
    {
      ...reader,
      DATABASE_URL: reader.DATABASE_URL.replaceAll(target, "abcdefghijklmnopqrst"),
      REDPRO_DB_TARGET_REF: "abcdefghijklmnopqrst",
    },
    { ...reader, DATABASE_URL: reader.DATABASE_URL.replace(":5432", ":6543") },
    {
      ...reader,
      DATABASE_URL: `postgresql://${LEDGER_READER_ROLE}@db.${target}.supabase.co:5432/postgres`,
    },
    { ...reader, REDPRO_DB_SSL_CA_FILE: "" },
  ])
    assert.throws(() => readInspectionDatabaseConfig(env));
});

test("the inspection entry point and migration CLI refuse up and down before connecting", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    DATABASE_URL: `postgresql://${LEDGER_READER_ROLE}:synthetic@127.0.0.1:1/redpro_test`,
    REDPRO_DB_ENV: "test",
    REDPRO_DB_TARGET_REF: "local-test",
  };
  const config = readInspectionDatabaseConfig(env);
  const inspect = (args: string[]) =>
    spawnSync(process.execPath, ["--experimental-strip-types", "scripts/db-inspect.ts", ...args], {
      env,
      encoding: "utf8",
    });
  const target = inspect(["target"]);
  assert.equal(target.status, 0, target.stderr);
  assert.equal(JSON.parse(target.stdout).connected, false);
  for (const args of [["up"], ["down"], ["status", "up"]]) {
    const result = inspect(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /DB_SAFETY_REFUSED/);
  }
  for (const command of ["up", "down"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/db.ts",
        command,
        `--confirm-target=${config.fingerprint}`,
        "--migration=synthetic",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /DB_SAFETY_REFUSED/);
  }
});

test("setup and disposable tests refuse preconfigured database credentials before installing or starting Docker", () => {
  for (const name of [
    "DATABASE_URL",
    "REDPRO_DB_PASSWORD",
    "SUPABASE_ACCESS_TOKEN",
    "REDPRO_DB_AUTH_MODE",
  ]) {
    for (const mode of ["setup", "test-db"]) {
      const result = spawnSync("bash", ["scripts/codespace.sh", mode], {
        env: { ...process.env, [name]: "synthetic-private-marker" },
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("synthetic-private-marker"));
      assert.match(result.stderr, /preparation refused/);
    }
  }
});

test("private inspection rejects piped secrets and provides no migration operation", () => {
  for (const args of [
    ["inspect", "a".repeat(40), `db.${target}.supabase.co`, "public.crt", "temporary"],
    ["up"],
    ["down"],
    ["migrate"],
    ["inspect", "unexpected"],
  ]) {
    const result = spawnSync("bash", ["scripts/codespace.sh", ...args], {
      env: { ...process.env, CODESPACES: "true", GITHUB_REPOSITORY: "Pedrooca4/redpro" },
      input: "synthetic-private-marker",
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("synthetic-private-marker"));
    assert.match(result.stderr, /preparation refused/);
  }
});
