import test from "node:test";
import assert from "node:assert/strict";
import {
  readDevelopmentDatabaseConfig,
  confirmDatabaseMutation,
  safeDatabaseFailure,
} from "../src/config/database.ts";
import { developmentPoolConfig } from "../src/db/connection.ts";

const ref = "abcdefghijklmnopqrst";
const remote = {
  DATABASE_URL: `postgresql://postgres:synthetic%21password@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
  REDPRO_DB_ENV: "development",
  REDPRO_DB_TARGET_REF: ref,
};

test("remote configuration pins the project and always verifies TLS", () => {
  const config = readDevelopmentDatabaseConfig(remote);
  const pool = developmentPoolConfig(config);
  assert.equal(config.password, "synthetic!password");
  assert.equal(config.provider, "supabase");
  assert.deepEqual(pool.ssl, { rejectUnauthorized: true });
  assert.equal(pool.max, 1);
  assert.equal(pool.connectionTimeoutMillis, 10_000);
  assert.equal(pool.statement_timeout, 15_000);
  assert.equal(pool.options, "-c timezone=UTC");
  assert.ok(!("connectionString" in pool), "URL options cannot override SSL settings");
});

test("separate raw password avoids URL encoding and refuses ambiguous sources", () => {
  const config = readDevelopmentDatabaseConfig({
    ...remote,
    DATABASE_URL: `postgresql://postgres@db.${ref}.supabase.co/postgres`,
    REDPRO_DB_PASSWORD: "synthetic!#@&secret",
  });
  assert.equal(config.password, "synthetic!#@&secret");
  assert.throws(() => readDevelopmentDatabaseConfig({ ...remote, REDPRO_DB_PASSWORD: "another" }));
});

test("session pooler username must identify the confirmed development project", () => {
  const DATABASE_URL = `postgres://postgres.${ref}:synthetic@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;
  assert.equal(readDevelopmentDatabaseConfig({ ...remote, DATABASE_URL }).target, ref);
  assert.throws(() =>
    readDevelopmentDatabaseConfig({
      ...remote,
      DATABASE_URL: DATABASE_URL.replace(ref, "wrongproject"),
    }),
  );
});

const refusedCases: [string, Record<string, string>][] = [
  ["production runtime", { NODE_ENV: "production" }],
  ["Vercel runtime", { VERCEL: "1" }],
  ["Vercel preview", { VERCEL_ENV: "preview" }],
  ["production database", { REDPRO_DB_ENV: "production" }],
  ["missing environment", { REDPRO_DB_ENV: "" }],
  ["wrong target ref", { REDPRO_DB_TARGET_REF: "wrong" }],
  ["transaction pooler", { DATABASE_URL: remote.DATABASE_URL.replace(":5432", ":6543") }],
  ["wrong database", { DATABASE_URL: remote.DATABASE_URL.replace("/postgres?", "/other?") }],
  ["malformed URL", { DATABASE_URL: "not a URL with synthetic-private-marker" }],
  ["TLS downgrade", { DATABASE_URL: remote.DATABASE_URL.replace("require", "disable") }],
  ["duplicate SSL option", { DATABASE_URL: remote.DATABASE_URL + "&sslmode=require" }],
  [
    "URL certificate override",
    { DATABASE_URL: remote.DATABASE_URL + "&sslrootcert=/private/path" },
  ],
  [
    "untrusted hostname",
    { DATABASE_URL: remote.DATABASE_URL.replace(`db.${ref}.supabase.co`, "malicious.example") },
  ],
  ["fragment", { DATABASE_URL: remote.DATABASE_URL + "#private" }],
];
for (const [label, override] of refusedCases) {
  test("unsafe configuration is refused without leaking values: " + label, () => {
    assert.throws(
      () => readDevelopmentDatabaseConfig({ ...remote, ...override }),
      (error: unknown) => {
        assert.deepEqual(safeDatabaseFailure(error), {
          event: "database.failed",
          code: "DB_SAFETY_REFUSED",
        });
        assert.ok(!String(error).includes("synthetic"));
        return true;
      },
    );
  });
}

test("test mode can only use the disposable loopback database", () => {
  const env = {
    DATABASE_URL: "postgresql://ci:synthetic@127.0.0.1:5432/redpro_test",
    REDPRO_DB_ENV: "test",
    REDPRO_DB_TARGET_REF: "local-test",
  };
  assert.equal(developmentPoolConfig(readDevelopmentDatabaseConfig(env)).ssl, false);
  assert.throws(() =>
    readDevelopmentDatabaseConfig({
      ...env,
      DATABASE_URL: env.DATABASE_URL.replace("redpro_test", "postgres"),
    }),
  );
  assert.throws(() => readDevelopmentDatabaseConfig({ ...remote, REDPRO_DB_ENV: "test" }));
  assert.throws(() => readDevelopmentDatabaseConfig({ ...env, REDPRO_DB_ENV: "development" }));
});

test("migration confirmation is tied to the target but not to the password", () => {
  const a = readDevelopmentDatabaseConfig(remote);
  const b = readDevelopmentDatabaseConfig({
    ...remote,
    DATABASE_URL: remote.DATABASE_URL.replace("synthetic%21password", "rotated"),
  });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.throws(() => confirmDatabaseMutation(a));
  assert.throws(() => confirmDatabaseMutation(a, "wrong-target"));
  assert.doesNotThrow(() => confirmDatabaseMutation(a, a.fingerprint));
});

test("unknown driver failures never expose error messages, SQL or secrets", () => {
  for (const error of [
    new Error("synthetic-private-marker"),
    { connectionString: "private", detail: "private" },
    null,
  ]) {
    assert.deepEqual(safeDatabaseFailure(error), {
      event: "database.failed",
      code: "DB_OPERATION_FAILED",
    });
  }
});
