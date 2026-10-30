import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { PostgresAdapter, sql, type Kysely } from "kysely";
import {
  DEFAULT_MIGRATION_LOCK_TABLE,
  MIGRATION_LOCK_ID,
  Migrator,
  FileMigrationProvider,
} from "kysely/migration";
import { DatabaseSafetyError, readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase, type Database } from "../../src/db/connection.ts";
import {
  MIGRATION_SCHEMA,
  createMigrator,
  migrationStatus,
  runDevelopmentMigration,
} from "../../src/db/migrator.ts";

// Real independent PostgreSQL sessions, never promises sharing one pool slot.
// The separate disposable database also isolates committed fixtures from the
// other suites, whose Supabase Auth doubles live in rollback-only transactions.
test("PostgreSQL runner: concurrent authorization, atomic ledger and lock release", async (t) => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const admin = createDevelopmentDatabase(config);
  const database = `redpro_runner_concurrency_${process.pid}`;
  const fixtureConfig = { ...config, database };
  const sessions: Kysely<Database>[] = [];
  const lockOptions = {
    lockTable: DEFAULT_MIGRATION_LOCK_TABLE,
    lockRowId: MIGRATION_LOCK_ID,
    lockTableSchema: MIGRATION_SCHEMA,
  };
  let created = false;
  try {
    // CREATE DATABASE deliberately refuses collisions; never adopt another DB.
    await sql`create database ${sql.id(database)}`.execute(admin);
    created = true;
    const db = createDevelopmentDatabase(fixtureConfig);
    const a = createDevelopmentDatabase(fixtureConfig);
    const b = createDevelopmentDatabase(fixtureConfig);
    const holder = createDevelopmentDatabase(fixtureConfig);
    sessions.push(db, a, b, holder);
    const pids = await Promise.all(
      [a, b].map(async (session) => {
        const r = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(session);
        return r.rows[0]!.pid;
      }),
    );
    assert.notEqual(pids[0], pids[1]);
    const names = (await migrationStatus(db)).map((m) => m.name);
    assert.equal(names.length, 6);
    const probe = names[0]!;
    const run = (session: Kysely<Database>, direction: "up" | "down", name: string) =>
      runDevelopmentMigration(session, fixtureConfig, direction, config.fingerprint, name);
    const applied = async () =>
      (await migrationStatus(db)).filter((m) => m.applied).map((m) => m.name);
    const refused = (result: PromiseSettledResult<unknown>) => {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.ok(result.reason instanceof DatabaseSafetyError);
    };
    const concurrent = async (first: () => Promise<unknown>, second: () => Promise<unknown>) => {
      // Hold the EXACT Kysely lock, then prove both runners have reached it.
      // No sleep used as a claim of synchronization: inspect PostgreSQL waiters.
      return holder.connection().execute(async (connection) => {
        const adapter = new PostgresAdapter();
        await adapter.acquireMigrationLock(connection, lockOptions);
        const results = Promise.allSettled([first(), second()]);
        try {
          const deadline = Date.now() + 10_000;
          for (;;) {
            const waiting = await sql<{ count: number }>`select count(*)::int as count
              from pg_stat_activity where pid in (${pids[0]},${pids[1]})
              and wait_event_type='Lock' and wait_event='advisory'`.execute(db);
            if (waiting.rows[0]?.count === 2) break;
            assert.ok(
              Date.now() < deadline,
              "Both sessions must block before reading/mutating the ledger",
            );
            await pause(10);
          }
        } finally {
          await adapter.releaseMigrationLock(connection, lockOptions);
        }
        return results;
      });
    };

    await t.test(
      "fresh ledger: duplicate up executes only the authorized first migration",
      async () => {
        const results = await concurrent(
          () => run(a, "up", probe),
          () => run(b, "up", probe),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        refused(results.find((r) => r.status === "rejected")!);
        const success = results.find((r) => r.status === "fulfilled");
        if (success?.status === "fulfilled")
          assert.deepEqual(success.value, {
            event: "database.migration",
            direction: "up",
            migration: probe,
            status: "success",
          });
        assert.deepEqual(await applied(), [probe]);
        const r = await sql<{ present: boolean }>`select
        to_regclass('redpro_dev_check.migration_probe') is not null
        and to_regclass('public.profiles') is null as present`.execute(db);
        assert.equal(r.rows[0]?.present, true);
      },
    );

    await t.test(
      "duplicate down cannot roll back another migration or report two successes",
      async () => {
        const results = await concurrent(
          () => run(a, "down", probe),
          () => run(b, "down", probe),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        refused(results.find((r) => r.status === "rejected")!);
        assert.deepEqual(await applied(), []);
        const r = await sql<{
          absent: boolean;
        }>`select to_regnamespace('redpro_dev_check') is null as absent`.execute(db);
        assert.equal(r.rows[0]?.absent, true);
      },
    );

    await t.test(
      "unexpected executed name rolls back real DDL and ledger before commit",
      async (child) => {
        const original = Migrator.prototype.migrateUp;
        // Fault injection AFTER actual PostgreSQL DDL and ledger insertion. This
        // proves a result mismatch is not merely detected after committing.
        const mock = child.mock.method(
          Migrator.prototype,
          "migrateUp",
          async function (this: Migrator) {
            const result = await original.call(this);
            assert.equal(result.error, undefined);
            assert.equal(result.results?.[0]?.migrationName, probe);
            return {
              ...result,
              results: result.results?.map((r) => ({
                ...r,
                migrationName: "unexpected_migration",
              })),
            };
          },
        );
        try {
          await assert.rejects(run(a, "up", probe), DatabaseSafetyError);
        } finally {
          mock.mock.restore();
        }
        assert.deepEqual(await applied(), []);
        const r = await sql<{
          absent: boolean;
        }>`select to_regnamespace('redpro_dev_check') is null as absent`.execute(db);
        assert.equal(r.rows[0]?.absent, true);
        // Another session can proceed, proving neither reentrant lock was leaked.
        await run(b, "up", probe);
        await run(b, "down", probe);
      },
    );

    await t.test("failed fresh migration leaves no metadata schema or false success", async () => {
      // Empty test ledger only, never production: exercise atomic initialization.
      await sql`drop table redpro_migrations.kysely_migration_lock`.execute(db);
      await sql`drop table redpro_migrations.kysely_migration`.execute(db);
      await sql`drop schema redpro_migrations`.execute(db);
      await sql`create schema redpro_dev_check`.execute(db);
      await assert.rejects(run(a, "up", probe), { message: "Migration failed" });
      const r = await sql<{
        absent: boolean;
      }>`select to_regnamespace('redpro_migrations') is null as absent`.execute(db);
      assert.equal(r.rows[0]?.absent, true);
      await sql`drop schema redpro_dev_check`.execute(db);
      await run(b, "up", probe);
    });

    await t.test(
      "failed down preserves the applied ledger and data, then releases lock",
      async () => {
        await sql`insert into redpro_dev_check.migration_probe(id) values (1)`.execute(db);
        await assert.rejects(run(a, "down", probe), { message: "Migration failed" });
        assert.deepEqual(await applied(), [probe]);
        const r = await sql<{
          count: number;
        }>`select count(*)::int as count from redpro_dev_check.migration_probe`.execute(db);
        assert.equal(r.rows[0]?.count, 1);
        await sql`delete from redpro_dev_check.migration_probe where id=1`.execute(db);
        await run(b, "down", probe);
      },
    );

    await t.test(
      "rechecks ledger after waiting even when another Kysely migrator advances it",
      async () => {
        await holder.connection().execute(async (connection) => {
          const adapter = new PostgresAdapter();
          await adapter.acquireMigrationLock(connection, lockOptions);
          const pending = Promise.allSettled([run(a, "up", probe)]);
          try {
            const deadline = Date.now() + 10_000;
            for (;;) {
              const r = await sql<{ waiting: boolean }>`select exists(select 1 from pg_stat_activity
              where pid=${pids[0]} and wait_event_type='Lock' and wait_event='advisory') as waiting`.execute(
                db,
              );
              if (r.rows[0]?.waiting) break;
              assert.ok(Date.now() < deadline, "Runner must wait on the existing Kysely lock");
              await pause(10);
            }
            const result = await createMigrator(connection).migrateUp();
            assert.equal(result.error, undefined);
            assert.equal(result.results?.[0]?.migrationName, probe);
          } finally {
            await adapter.releaseMigrationLock(connection, lockOptions);
          }
          refused((await pending)[0]!);
        });
        assert.deepEqual(await applied(), [probe]);
        await run(b, "down", probe);
      },
    );

    await t.test(
      "two executable steps: duplicate requests never advance or reverse the adjacent step",
      async (child) => {
        // Synthetic provider, real SQL/ledger/locks. Unlike the production Auth
        // migration these two independent steps can both execute without global
        // role fixtures. Existing suites separately validate all six frozen files.
        const mock = child.mock.method(
          FileMigrationProvider.prototype,
          "getMigrations",
          async () => ({
            "001_alpha": {
              up: async (trx: Kysely<unknown>) => {
                await sql`create table public.alpha(id integer primary key)`.execute(trx);
              },
              down: async (trx: Kysely<unknown>) => {
                await sql`drop table public.alpha`.execute(trx);
              },
            },
            "002_beta": {
              up: async (trx: Kysely<unknown>) => {
                await sql`create table public.beta(id integer primary key)`.execute(trx);
              },
              down: async (trx: Kysely<unknown>) => {
                await sql`drop table public.beta`.execute(trx);
              },
            },
          }),
        );
        try {
          // Reproduce the original pre-lock selection with real Kysely/SQL.
          const legacy = async (session: Kysely<Database>) => {
            const requested = (await migrationStatus(session)).find((m) => !m.applied)!.name;
            const result = await createMigrator(session).migrateUp();
            assert.equal(result.error, undefined);
            return { requested, executed: result.results?.[0]?.migrationName };
          };
          const legacyResults = await concurrent(
            () => legacy(a),
            () => legacy(b),
          );
          const legacyValues = legacyResults.map((r) => {
            assert.equal(r.status, "fulfilled");
            if (r.status !== "fulfilled") throw new Error("Legacy fixture did not execute");
            return r.value as { requested: string; executed: string };
          });
          assert.deepEqual(
            legacyValues.map((r) => r.requested),
            ["001_alpha", "001_alpha"],
          );
          assert.deepEqual(legacyValues.map((r) => r.executed).sort(), ["001_alpha", "002_beta"]);
          assert.deepEqual(await applied(), ["001_alpha", "002_beta"]);
          await run(b, "down", "002_beta");
          await run(b, "down", "001_alpha");

          const up = await concurrent(
            () => run(a, "up", "001_alpha"),
            () => run(b, "up", "001_alpha"),
          );
          assert.equal(up.filter((r) => r.status === "fulfilled").length, 1);
          refused(up.find((r) => r.status === "rejected")!);
          assert.deepEqual(await applied(), ["001_alpha"]);
          await run(a, "up", "002_beta");
          const down = await concurrent(
            () => run(a, "down", "002_beta"),
            () => run(b, "down", "002_beta"),
          );
          assert.equal(down.filter((r) => r.status === "fulfilled").length, 1);
          refused(down.find((r) => r.status === "rejected")!);
          assert.deepEqual(await applied(), ["001_alpha"]);
          const r = await sql<{
            safe: boolean;
          }>`select to_regclass('public.alpha') is not null and to_regclass('public.beta') is null as safe`.execute(
            db,
          );
          assert.equal(r.rows[0]?.safe, true);
          await run(b, "down", "001_alpha");
        } finally {
          mock.mock.restore();
        }
        assert.deepEqual(await applied(), []);
      },
    );

    await t.test(
      "a success result without the required ledger transition is refused",
      async (child) => {
        const mock = child.mock.method(Migrator.prototype, "migrateUp", async () => ({
          results: [{ migrationName: probe, direction: "Up" as const, status: "Success" as const }],
        }));
        try {
          await assert.rejects(run(a, "up", probe), DatabaseSafetyError);
        } finally {
          mock.mock.restore();
        }
        assert.deepEqual(await applied(), []);
      },
    );

    await t.test(
      "wrong target, wrong migration and foreign ledger remain fail closed",
      async () => {
        await assert.rejects(
          runDevelopmentMigration(a, fixtureConfig, "up", "wrong", probe),
          DatabaseSafetyError,
        );
        await assert.rejects(run(a, "up", names[1]!), DatabaseSafetyError);
        await sql`comment on schema redpro_migrations is 'foreign owner marker'`.execute(db);
        await assert.rejects(run(a, "up", probe), DatabaseSafetyError);
        await sql`comment on schema redpro_migrations is 'RedPro development migration ledger v1'`.execute(
          db,
        );
        assert.deepEqual(await applied(), []);
        await run(b, "up", probe);
        await run(b, "down", probe);
      },
    );
  } finally {
    await Promise.all(sessions.map((db) => db.destroy()));
    try {
      if (created) await sql`drop database ${sql.id(database)}`.execute(admin);
    } finally {
      await admin.destroy();
    }
  }
});
