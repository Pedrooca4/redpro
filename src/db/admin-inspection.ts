import { sql, type Kysely } from "kysely";
import { DEFAULT_MIGRATION_TABLE } from "kysely/migration";
import { DatabaseSafetyError } from "../config/database.ts";
import type { Database } from "./connection.ts";
import { MIGRATION_SCHEMA, migrationStatus } from "./migrator.ts";

export function inspectAdministrativeLedger(db: Kysely<Database>) {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (trx) => {
      const result = await sql<{
        role: string;
        database: string;
        version: string;
        read_only: string;
      }>`select current_user as role, pg_catalog.current_database() as database,
          pg_catalog.current_setting('transaction_read_only') as read_only,
          pg_catalog.current_setting('server_version_num') as version`.execute(trx);
      const identity = result.rows[0];
      if (
        identity?.role !== "postgres" ||
        identity.database !== "postgres" ||
        identity.read_only !== "on"
      )
        throw new DatabaseSafetyError();

      // Resolve the same ledger as the migrator without taking its advisory lock.
      await sql`set local search_path = pg_catalog`.execute(trx);
      const ledgerName = `${MIGRATION_SCHEMA}.${DEFAULT_MIGRATION_TABLE}`;
      const relation = await sql<{ kind: string; inherited: boolean }>`
        select c.relkind as kind, exists (
          select 1 from pg_inherits i where c.oid in (i.inhparent, i.inhrelid)
        ) as inherited from pg_class c where c.oid = to_regclass(${ledgerName})
      `.execute(trx);
      const ledger = relation.rows[0];
      if (ledger && (ledger.kind !== "r" || ledger.inherited)) throw new DatabaseSafetyError();

      const migrations = await migrationStatus(trx);
      if (ledger) {
        const total = await sql<{ total: string }>`
          select count(*)::text as total from ${sql.table(ledgerName)}
        `.execute(trx);
        const applied = migrations.filter((migration) => migration.applied).length;
        if (
          total.rows[0]?.total !== String(applied) ||
          migrations.slice(0, applied).some((migration) => !migration.applied)
        )
          throw new DatabaseSafetyError();
      }
      return {
        postgresMajor: Math.floor(Number(identity.version) / 10000),
        ledgerPresent: Boolean(ledger),
        migrations,
      };
    });
}
