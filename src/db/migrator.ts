import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql, type Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import {
  DatabaseSafetyError,
  confirmDatabaseMutation,
  type DevelopmentDatabaseConfig,
} from "../config/database.ts";
import type { Database } from "./connection.ts";

export const MIGRATION_SCHEMA = "redpro_migrations";
const OWNER_MARKER = "RedPro development migration ledger v1";

export function createMigrator(db: Kysely<Database>) {
  return new Migrator({
    db,
    migrationTableSchema: MIGRATION_SCHEMA,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: fileURLToPath(new URL("./migrations/", import.meta.url)),
      import: (filename) => import(pathToFileURL(filename).href),
    }),
  });
}

async function inspectLedger(db: Kysely<Database>) {
  const result = await sql<{ marker: string | null }>`
    select obj_description(oid, 'pg_namespace') as marker
    from pg_namespace where nspname = ${MIGRATION_SCHEMA}
  `.execute(db);
  if (result.rows.length && result.rows[0]?.marker !== OWNER_MARKER)
    throw new DatabaseSafetyError();
  return result.rows.length > 0;
}

export async function migrationStatus(db: Kysely<Database>) {
  await inspectLedger(db);
  return (await createMigrator(db).getMigrations()).map(({ name, executedAt }) => ({
    name,
    applied: Boolean(executedAt),
  }));
}

export async function runDevelopmentMigration(
  db: Kysely<Database>,
  config: DevelopmentDatabaseConfig,
  direction: "up" | "down",
  confirmation: string | undefined,
  expectedMigration: string | undefined,
) {
  confirmDatabaseMutation(config, confirmation);
  const before = await migrationStatus(db);
  const next =
    direction === "up" ? before.find((m) => !m.applied) : before.filter((m) => m.applied).at(-1);
  if (!next || next.name !== expectedMigration) throw new DatabaseSafetyError();
  if (!(await inspectLedger(db))) {
    // All metadata creation is an explicit mutation, never part of check/status/build.
    await db.transaction().execute(async (trx) => {
      await trx.schema.createSchema(MIGRATION_SCHEMA).execute();
      await sql`comment on schema redpro_migrations is 'RedPro development migration ledger v1'`.execute(
        trx,
      );
      await sql`revoke all on schema redpro_migrations from public`.execute(trx);
    });
  }
  const migrator = createMigrator(db);
  const result = direction === "up" ? await migrator.migrateUp() : await migrator.migrateDown();
  if (result.error) throw new Error("Migration failed");
  if (result.results?.length !== 1 || result.results[0]?.status !== "Success")
    throw new Error("Migration result mismatch");
  return { event: "database.migration", direction, migration: next.name, status: "success" };
}
