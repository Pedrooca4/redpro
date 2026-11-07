import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql, type Kysely } from "kysely";
import {
  DEFAULT_MIGRATION_LOCK_TABLE,
  FileMigrationProvider,
  MIGRATION_LOCK_ID,
  Migrator,
} from "kysely/migration";
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

export function readDevelopmentMigrationStatus(db: Kysely<Database>) {
  // Kysely getMigrations reads the ledger and treats a missing table as empty.
  // The server must enforce read-only even if that behavior changes.
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(migrationStatus);
}

export async function runDevelopmentMigration(
  db: Kysely<Database>,
  config: DevelopmentDatabaseConfig,
  direction: "up" | "down",
  confirmation: string | undefined,
  expectedMigration: string | undefined,
) {
  confirmDatabaseMutation(config, confirmation);
  // Use PostgreSQL's existing Kysely lock, on one pinned connection. The outer
  // acquisition remains held through COMMIT/ROLLBACK. The dialect uses the same
  // key for transaction-scoped inner acquisitions, including aborted SQL.
  return db.connection().execute(async (connection) => {
    const adapter = connection.getExecutor().adapter;
    const lockOptions = {
      lockTable: DEFAULT_MIGRATION_LOCK_TABLE,
      lockRowId: MIGRATION_LOCK_ID,
      lockTableSchema: MIGRATION_SCHEMA,
    };
    await adapter.acquireMigrationLock(connection, lockOptions);
    try {
      return await connection
        .transaction()
        .setIsolationLevel("read committed")
        .execute(async (trx) => {
          const before = await migrationStatus(trx);
          const next =
            direction === "up"
              ? before.find((m) => !m.applied)
              : before.filter((m) => m.applied).at(-1);
          if (!next || next.name !== expectedMigration) throw new DatabaseSafetyError();
          if (!(await inspectLedger(trx))) {
            // Metadata and the migration itself commit together, under the lock.
            await trx.schema.createSchema(MIGRATION_SCHEMA).execute();
            await sql`comment on schema redpro_migrations is 'RedPro development migration ledger v1'`.execute(
              trx,
            );
            await sql`revoke all on schema redpro_migrations from public`.execute(trx);
          }
          const migrator = createMigrator(trx);
          const result =
            direction === "up" ? await migrator.migrateUp() : await migrator.migrateDown();
          if (result.error) throw new Error("Migration failed");
          const executed = result.results?.[0];
          // This check must run BEFORE the outer transaction commits. Merely
          // comparing a name after migrateUp() committed would be too late.
          if (
            result.results?.length !== 1 ||
            executed?.status !== "Success" ||
            executed.migrationName !== expectedMigration ||
            executed.direction !== (direction === "up" ? "Up" : "Down")
          )
            throw new DatabaseSafetyError();
          const after = await migrationStatus(trx);
          if (
            after.length !== before.length ||
            after.some((migration, index) => {
              const previous = before[index]!;
              return (
                migration.name !== previous.name ||
                migration.applied !==
                  (migration.name === expectedMigration ? direction === "up" : previous.applied)
              );
            })
          )
            throw new DatabaseSafetyError();
          return {
            event: "database.migration",
            direction,
            migration: executed.migrationName,
            status: "success",
          };
        });
    } finally {
      await adapter.releaseMigrationLock(connection, lockOptions);
    }
  });
}
