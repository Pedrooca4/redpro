import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext, TLSSocket } from "node:tls";
import test from "node:test";
import { sql } from "kysely";
import { DatabaseSafetyError, readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase } from "../../src/db/connection.ts";
import { inspectAdministrativeLedger } from "../../src/db/admin-inspection.ts";

function disposableConfig() {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  assert.equal(config.host, "127.0.0.1");
  return config;
}

test("PostgreSQL: administrative inspection verifies identity and leaves missing metadata untouched", async () => {
  const config = disposableConfig();
  const password = "disposable-admin-inspection-fixture";
  const control = createDevelopmentDatabase(config);
  const fixture = createDevelopmentDatabase({ ...config, database: "postgres" });
  const postgres = createDevelopmentDatabase({
    ...config,
    database: "postgres",
    user: "postgres",
    password,
  });
  const wrongDatabase = createDevelopmentDatabase({ ...config, user: "postgres", password });
  const wrongPassword = createDevelopmentDatabase({
    ...config,
    database: "postgres",
    user: "postgres",
    password: "disposable-invalid",
  });
  let created = false;
  let schemaCreated = false;
  try {
    await sql`create role postgres login password ${sql.lit(password)}`.execute(control);
    created = true;

    await assert.rejects(inspectAdministrativeLedger(fixture), DatabaseSafetyError);
    await assert.rejects(inspectAdministrativeLedger(wrongDatabase), DatabaseSafetyError);
    await assert.rejects(inspectAdministrativeLedger(wrongPassword), { code: "28P01" });
    const { ledgerPresent, migrations: pending } = await inspectAdministrativeLedger(postgres);
    assert.equal(ledgerPresent, false);
    assert.equal(pending.length, 6);
    assert.ok(pending.every((entry) => !entry.applied));
    assert.equal(
      (
        await sql<{
          absent: boolean;
        }>`select to_regnamespace('redpro_migrations') is null as absent`.execute(fixture)
      ).rows[0]?.absent,
      true,
    );

    await sql`create schema redpro_migrations authorization postgres`.execute(fixture);
    schemaCreated = true;
    await assert.rejects(inspectAdministrativeLedger(postgres), DatabaseSafetyError);
    await sql`comment on schema redpro_migrations is 'RedPro development migration ledger v1'`.execute(
      fixture,
    );
    assert.deepEqual((await inspectAdministrativeLedger(postgres)).migrations, pending);

    await sql`create table redpro_migrations.kysely_migration (
      name varchar(255) primary key, "timestamp" varchar(255) not null
    )`.execute(postgres);
    const emptyLedger = await inspectAdministrativeLedger(postgres);
    assert.equal(emptyLedger.ledgerPresent, true);
    assert.deepEqual(emptyLedger.migrations, pending);
    assert.equal(
      (
        await sql<{
          absent: boolean;
        }>`select to_regclass('redpro_migrations.kysely_migration_lock') is null as absent`.execute(
          fixture,
        )
      ).rows[0]?.absent,
      true,
    );

    await sql`insert into redpro_migrations.kysely_migration values
      (${pending[0]!.name}, '2026-10-28T00:00:00.000Z')`.execute(postgres);
    const expected = pending.map((entry, index) => ({ ...entry, applied: index === 0 }));
    assert.deepEqual((await inspectAdministrativeLedger(postgres)).migrations, expected);
    await sql`insert into redpro_migrations.kysely_migration values
      ('unknown-fixture-only', '2026-10-28T00:00:00.000Z')`.execute(postgres);
    await assert.rejects(inspectAdministrativeLedger(postgres), DatabaseSafetyError);
  } finally {
    try {
      if (schemaCreated) {
        await sql`drop table if exists redpro_migrations.kysely_migration`.execute(postgres);
        await sql`drop schema redpro_migrations`.execute(fixture);
      }
    } finally {
      try {
        await Promise.all([
          postgres.destroy(),
          wrongDatabase.destroy(),
          wrongPassword.destroy(),
          fixture.destroy(),
        ]);
        if (created) await sql`drop role postgres`.execute(control);
      } finally {
        await control.destroy();
      }
    }
  }
});

test("administrative inspection stops after a failed TLS handshake with no downgrade or retry", async () => {
  const config = disposableConfig();
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.once("data", () => socket.end("N"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const db = createDevelopmentDatabase({
    ...config,
    provider: "supabase",
    port: address.port,
    database: "postgres",
    user: "postgres",
  });
  try {
    await assert.rejects(inspectAdministrativeLedger(db), /does not support SSL/);
    assert.equal(connections, 1);
  } finally {
    await db.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("administrative inspection rejects an untrusted chain and a mismatched hostname", async () => {
  const config = disposableConfig();
  const dir = mkdtempSync(join(tmpdir(), "minepro-disposable-tls-"));
  try {
    const certPath = join(dir, "server.crt");
    const keyPath = join(dir, "server.key");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=not-loopback.example.test",
        "-addext",
        "subjectAltName=DNS:not-loopback.example.test",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    const cert = readFileSync(certPath, "utf8");
    const secureContext = createSecureContext({ cert, key: readFileSync(keyPath) });
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      socket.once("data", () => {
        socket.write("S");
        const secure = new TLSSocket(socket, { isServer: true, secureContext });
        secure.on("error", () => secure.destroy());
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      for (const [ca, code, expectedConnections] of [
        [undefined, "DEPTH_ZERO_SELF_SIGNED_CERT", 1],
        [cert, "ERR_TLS_CERT_ALTNAME_INVALID", 2],
      ] as const) {
        const db = createDevelopmentDatabase({
          ...config,
          provider: "supabase",
          port: address.port,
          database: "postgres",
          user: "postgres",
          ca,
        });
        try {
          await assert.rejects(inspectAdministrativeLedger(db), { code });
          assert.equal(connections, expectedConnections);
        } finally {
          await db.destroy();
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
