import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase, checkDevelopmentConnection } from "../../src/db/connection.ts";
import { migrationStatus } from "../../src/db/migrator.ts";

test("PostgreSQL inspection: read-only sessions reject DML and DDL without changing data or ledger", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const admin = createDevelopmentDatabase(config);
  const reader = createDevelopmentDatabase(config, { readOnly: true });
  let created = false;
  try {
    await sql`create table public.redpro_inspection_fixture(id integer primary key)`.execute(admin);
    created = true;
    await sql`insert into public.redpro_inspection_fixture values (1)`.execute(admin);
    assert.equal((await checkDevelopmentConnection(reader, config)).readOnly, true);
    assert.equal((await migrationStatus(reader)).length, 6);
    const state = await sql<{
      mode: string;
    }>`select current_setting('default_transaction_read_only') as mode`.execute(reader);
    assert.equal(state.rows[0]?.mode, "on");
    for (const query of [
      sql`insert into public.redpro_inspection_fixture values (2)`,
      sql`update public.redpro_inspection_fixture set id=3`,
      sql`delete from public.redpro_inspection_fixture`,
      sql`create table public.redpro_inspection_forbidden(id integer)`,
    ])
      await assert.rejects(query.execute(reader), { code: "25006" });
    const rows = await sql<{ id: number }>`select id from public.redpro_inspection_fixture`.execute(
      reader,
    );
    assert.deepEqual(rows.rows, [{ id: 1 }]);
    const absent = await sql<{
      absent: boolean;
    }>`select to_regclass('public.redpro_inspection_forbidden') is null as absent`.execute(reader);
    assert.equal(absent.rows[0]?.absent, true);
  } finally {
    await reader.destroy();
    try {
      if (created) await sql`drop table public.redpro_inspection_fixture`.execute(admin);
    } finally {
      await admin.destroy();
    }
  }
});
