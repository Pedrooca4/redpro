import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "kysely";
import {
  DatabaseSafetyError,
  LEDGER_READER_ROLE,
  readDevelopmentDatabaseConfig,
  readInspectionDatabaseConfig,
} from "../../src/config/database.ts";
import { checkDevelopmentConnection, createDevelopmentDatabase } from "../../src/db/connection.ts";
import { readDevelopmentMigrationStatus, runDevelopmentMigration } from "../../src/db/migrator.ts";

test("PostgreSQL: ledger reader handles absent metadata and cannot write or migrate", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const database = `minepro_ledger_inspection_${process.pid}`;
  const role = sql.id(LEDGER_READER_ROLE);
  const password = "synthetic-disposable-ledger-reader";
  const readerConfig = readInspectionDatabaseConfig({
    DATABASE_URL: `postgresql://${LEDGER_READER_ROLE}:${password}@127.0.0.1:${config.port}/redpro_test`,
    REDPRO_DB_ENV: "test",
    REDPRO_DB_TARGET_REF: "local-test",
  });
  const admin = createDevelopmentDatabase(config);
  const fixture = createDevelopmentDatabase({ ...config, database });
  const reader = createDevelopmentDatabase({ ...readerConfig, database });
  let databaseCreated = false;
  let roleCreated = false;
  try {
    await sql`create database ${sql.id(database)}`.execute(admin);
    databaseCreated = true;
    await sql`create role ${role} login noinherit nosuperuser nocreatedb nocreaterole nobypassrls
      password ${sql.lit(password)}`.execute(admin);
    roleCreated = true;
    await sql`revoke all on database ${sql.id(database)} from public`.execute(admin);
    await sql`grant connect on database ${sql.id(database)} to ${role}`.execute(admin);
    await sql`revoke all on schema public from public`.execute(fixture);

    assert.equal(
      (await checkDevelopmentConnection(reader, { ...readerConfig, database })).readOnly,
      true,
    );
    const pending = await readDevelopmentMigrationStatus(reader);
    assert.equal(pending.length, 6);
    assert.ok(pending.every((migration) => !migration.applied));
    const missing = await sql<{ absent: boolean }>`
      select to_regnamespace('redpro_migrations') is null as absent
    `.execute(fixture);
    assert.equal(missing.rows[0]?.absent, true);

    await sql`create schema redpro_migrations`.execute(fixture);
    await sql`comment on schema redpro_migrations is 'RedPro development migration ledger v1'`.execute(
      fixture,
    );
    await sql`grant usage on schema redpro_migrations to ${role}`.execute(fixture);
    assert.deepEqual(await readDevelopmentMigrationStatus(reader), pending);
    const tables = await sql<{ name: string }>`
      select relname as name from pg_class
      where relnamespace = 'redpro_migrations'::regnamespace
    `.execute(fixture);
    assert.deepEqual(tables.rows, []);

    // Canonical Kysely ledger created only by the fixture administrator.
    const migration = pending[0]!.name;
    await runDevelopmentMigration(
      fixture,
      { ...config, database },
      "up",
      config.fingerprint,
      migration,
    );
    await sql`grant select (name, "timestamp") on redpro_migrations.kysely_migration to ${role}`.execute(
      fixture,
    );
    const expected = pending.map((entry, index) => ({ ...entry, applied: index === 0 }));
    assert.deepEqual(await readDevelopmentMigrationStatus(reader), expected);

    // Use normal transactions here so SQLSTATE proves the role's ACLs, not READ ONLY mode.
    for (const query of [
      sql`insert into redpro_migrations.kysely_migration (name, "timestamp") values ('forged', 'now')`,
      sql`update redpro_migrations.kysely_migration set "timestamp" = 'forged'`,
      sql`delete from redpro_migrations.kysely_migration`,
      sql`create table redpro_migrations.forged (id integer)`,
      sql`create schema forged`,
      sql`create temporary table forged (id integer)`,
      sql`select * from redpro_migrations.kysely_migration_lock`,
      sql`select * from redpro_dev_check.migration_probe`,
    ])
      await assert.rejects(query.execute(reader), { code: "42501" });

    for (const direction of ["up", "down"] as const)
      await assert.rejects(
        runDevelopmentMigration(
          reader,
          { ...readerConfig, database },
          direction,
          readerConfig.fingerprint,
          direction === "up" ? pending[1]!.name : migration,
        ),
        DatabaseSafetyError,
      );
    assert.deepEqual(await readDevelopmentMigrationStatus(reader), expected);
  } finally {
    try {
      await Promise.all([reader.destroy(), fixture.destroy()]);
      if (databaseCreated) await sql`drop database ${sql.id(database)}`.execute(admin);
      if (roleCreated) await sql`drop role ${role}`.execute(admin);
    } finally {
      await admin.destroy();
    }
  }
});
