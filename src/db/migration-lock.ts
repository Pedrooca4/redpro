import {
  PostgresAdapter,
  PostgresDialect,
  sql,
  type Kysely,
  type MigrationLockOptions,
} from "kysely";

// Same advisory key as the pinned Kysely 0.29.7 PostgreSQL adapter. The integration
// suite takes the vanilla adapter's lock to prove compatibility, not a copy of
// this constant. Review this contract when upgrading Kysely.
const KYSELY_POSTGRES_LOCK_ID = "3853314791062309107";

class DevelopmentMigrationAdapter extends PostgresAdapter {
  override async acquireMigrationLock(db: Kysely<unknown>, options: MigrationLockOptions) {
    if (!db.isTransaction) return super.acquireMigrationLock(db, options);
    // An aborted SQL transaction cannot execute pg_advisory_unlock(). A
    // transaction-scoped inner acquisition is instead released by COMMIT or
    // ROLLBACK, including errors in ledger initialization or migration SQL.
    await sql`select pg_advisory_xact_lock(${KYSELY_POSTGRES_LOCK_ID}::bigint)`.execute(db);
  }

  override async releaseMigrationLock(db: Kysely<unknown>, options: MigrationLockOptions) {
    if (!db.isTransaction) await super.releaseMigrationLock(db, options);
  }
}

export class DevelopmentPostgresDialect extends PostgresDialect {
  override createAdapter() {
    return new DevelopmentMigrationAdapter();
  }
}
