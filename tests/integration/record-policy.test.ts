import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase } from "../../src/db/connection.ts";
import {
  newRecordId,
  parseRecordId,
  toUtcTimestamp,
  updatedAt,
  type RecordColumns,
} from "../../src/db/record-policy.ts";

test("PostgreSQL: UUID defaults, UTC/offset roundtrip and server timestamps across updates", async () => {
  const config = readDevelopmentDatabaseConfig();
  // No env-file loading, remote targets or product migrations in this fixture.
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  try {
    await db.transaction().execute(async (trx) => {
      const zone = await sql<{ zone: string }>`select current_setting('TimeZone') as zone`.execute(
        trx,
      );
      assert.equal(zone.rows[0]?.zone, "UTC");
      // Frozen SQL is the template for future migrations, not a product table.
      await sql`create temporary table red023_records (
        id uuid primary key default gen_random_uuid(),
        payload text not null,
        created_at timestamptz(3) not null default now(),
        updated_at timestamptz(3) not null default now()
      ) on commit drop`.execute(trx);
      const records = trx.withTables<{ red023_records: RecordColumns & { payload: string } }>();
      const row = await records
        .insertInto("red023_records")
        .values({ payload: "synthetic" })
        .returningAll()
        .executeTakeFirstOrThrow();
      assert.equal(parseRecordId(row.id), row.id);
      assert.equal(row.created_at.getTime(), row.updated_at.getTime());
      const explicitId = newRecordId();
      await records
        .insertInto("red023_records")
        .values({ id: explicitId, payload: "explicit" })
        .execute();
      await sql`savepoint duplicate_check`.execute(trx);
      await assert.rejects(
        records
          .insertInto("red023_records")
          .values({ id: explicitId, payload: "duplicate" })
          .execute(),
        { code: "23505" },
      );
      await sql`rollback to savepoint duplicate_check`.execute(trx);
      await sql`release savepoint duplicate_check`.execute(trx);
      const first = row;
      await sql`select pg_sleep(0.02)`.execute(trx);
      const changed = await records
        .updateTable("red023_records")
        .set({ payload: "after", updated_at: updatedAt() })
        .where("id", "=", first.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      assert.equal(changed.id, first.id);
      assert.equal(changed.created_at.getTime(), first.created_at.getTime());
      assert.ok(changed.updated_at.getTime() > first.updated_at.getTime());
      await sql`set local timezone to 'America/Sao_Paulo'`.execute(trx);
      const same = await records
        .selectFrom("red023_records")
        .selectAll()
        .where("id", "=", first.id)
        .executeTakeFirstOrThrow();
      assert.equal(toUtcTimestamp(same.updated_at), toUtcTimestamp(changed.updated_at));
      const instant = "2026-10-29T12:30:00.123-03:00";
      const offset = await sql<{
        instant: Date;
      }>`select ${instant}::timestamptz(3) as instant`.execute(trx);
      assert.equal(toUtcTimestamp(offset.rows[0]!.instant), "2026-10-29T15:30:00.123Z");
    });
  } finally {
    await db.destroy();
  }
});
