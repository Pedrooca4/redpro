import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase, checkDevelopmentConnection } from "../../src/db/connection.ts";
import { migrationStatus, runDevelopmentMigration } from "../../src/db/migrator.ts";

test("PostgreSQL: connect, migrate, protect data, roll back, reapply and preserve unrelated objects", async () => {
  const config = readDevelopmentDatabaseConfig();
  // This suite writes fixtures. It is NEVER allowed to run against Supabase.
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  try {
    const proof = await checkDevelopmentConnection(db, config);
    assert.equal(proof.readOnly, true);
    const before = await migrationStatus(db);
    assert.equal(before.length, 6);
    assert.match(before[0]!.name, /_development_probe$/);
    assert.match(before[1]!.name, /_profiles$/);
    assert.equal(before[1]?.applied, false);
    assert.match(before[2]!.name, /_conversations_messages$/);
    assert.equal(before[2]?.applied, false);
    assert.match(before[3]!.name, /_projects$/);
    assert.equal(before[3]?.applied, false);
    assert.match(before[4]!.name, /_community$/);
    assert.equal(before[4]?.applied, false);
    assert.match(before[5]!.name, /_reports_moderation$/);
    assert.equal(before[5]?.applied, false);
    assert.equal(before[0]?.applied, false);
    const name = before[0]!.name;
    await db.schema.createTable("redpro_ci_guard").addColumn("value", "text").execute();
    const marker = "synthetic-ci-sentinel";
    await sql`insert into redpro_ci_guard(value) values (${marker})`.execute(db);

    await assert.rejects(runDevelopmentMigration(db, config, "up", "wrong", name));
    const absent = await sql<{
      missing: boolean;
    }>`select to_regnamespace('redpro_migrations') is null as missing`.execute(db);
    assert.equal(absent.rows[0]?.missing, true, "Refusal must occur before metadata writes");

    await runDevelopmentMigration(db, config, "up", config.fingerprint, name);
    assert.equal((await migrationStatus(db))[0]?.applied, true);
    const rls = await sql<{
      enabled: boolean;
    }>`select relrowsecurity as enabled from pg_class where oid = 'redpro_dev_check.migration_probe'::regclass`.execute(
      db,
    );
    assert.equal(rls.rows[0]?.enabled, true);

    // Parameter binding treats SQL-looking text as data.
    const payload = "'; drop table redpro_ci_guard; --";
    const parameter = await sql<{ value: string }>`select ${payload}::text as value`.execute(db);
    assert.equal(parameter.rows[0]?.value, payload);
    await sql`insert into redpro_dev_check.migration_probe(id) values (${1})`.execute(db);
    await assert.rejects(runDevelopmentMigration(db, config, "down", config.fingerprint, name));
    assert.equal(
      (await migrationStatus(db))[0]?.applied,
      true,
      "Failed rollback keeps migration applied",
    );
    await sql`delete from redpro_dev_check.migration_probe where id = ${1}`.execute(db);
    await runDevelopmentMigration(db, config, "down", config.fingerprint, name);
    const removed = await sql<{
      missing: boolean;
    }>`select to_regnamespace('redpro_dev_check') is null as missing`.execute(db);
    assert.equal(removed.rows[0]?.missing, true);
    assert.equal((await migrationStatus(db))[0]?.applied, false);

    // A pre-existing schema is a collision, never something to adopt or delete.
    await db.schema.createSchema("redpro_dev_check").execute();
    await assert.rejects(runDevelopmentMigration(db, config, "up", config.fingerprint, name));
    await db.schema.dropSchema("redpro_dev_check").execute();
    await runDevelopmentMigration(db, config, "up", config.fingerprint, name);
    await runDevelopmentMigration(db, config, "down", config.fingerprint, name);
    const guard = await sql<{ value: string }>`select value from redpro_ci_guard`.execute(db);
    assert.deepEqual(guard.rows, [{ value: marker }]);
    await db.schema.dropTable("redpro_ci_guard").execute();
  } finally {
    await db.destroy();
  }
});
