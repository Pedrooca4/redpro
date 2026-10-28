import { sql, type Kysely } from "kysely";

// Freeze migrations in time: do not import the evolving application schema.
export async function up(db: Kysely<unknown>): Promise<void> {
  // Technical, empty proof table. No product data or public schema changes.
  // No IF NOT EXISTS: collisions must fail instead of adopting existing objects.
  await db.schema.createSchema("redpro_dev_check").execute();
  await db.schema
    .withSchema("redpro_dev_check")
    .createTable("migration_probe")
    .addColumn("id", "integer", (column) => column.primaryKey())
    .addColumn("checked_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`alter table redpro_dev_check.migration_probe enable row level security`.execute(db);
  await sql`revoke all on schema redpro_dev_check from public`.execute(db);
  await sql`revoke all on table redpro_dev_check.migration_probe from public`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const result = await sql<{ occupied: boolean }>`
    select exists(select 1 from redpro_dev_check.migration_probe) as occupied
  `.execute(db);
  if (result.rows[0]?.occupied !== false) throw new Error("Refusing rollback of a non-empty probe");
  await db.schema.withSchema("redpro_dev_check").dropTable("migration_probe").execute();
  // Never CASCADE: unrelated objects cause the whole transaction to roll back.
  await db.schema.dropSchema("redpro_dev_check").execute();
}
