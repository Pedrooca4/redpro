import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase, type Database } from "../../src/db/connection.ts";
import { parseAuthUserId } from "../../src/db/profiles.ts";
import { toUtcTimestamp, updatedAt } from "../../src/db/record-policy.ts";
import { up, down } from "../../src/db/migrations/20261029222313139_profiles.ts";

test("PostgreSQL profiles: frozen migration, Auth FK, RLS isolation, least privilege and safe rollback", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  const rollback = new Error("Rollback RED-013 disposable Auth fixture");
  const a = parseAuthUserId("c301fc1a-44f5-4140-b786-4965af4a1dad");
  // A provider-owned ID of a different UUID version must retain its identity.
  const b = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
  const orphan = parseAuthUserId("6c8a8131-1472-48c1-a41c-e8e02678c2dd");
  try {
    await sql`select 1`.execute(db);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        const absent = await sql<{ clear: boolean }>`select
        to_regnamespace('auth') is null and to_regclass('public.profiles') is null
        and to_regnamespace('minepro_profile_internal') is null
        and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clear`.execute(
          trx,
        );
        assert.equal(absent.rows[0]?.clear, true, "Refuse pre-existing fixture objects/roles");
        const mustFail = async (run: () => Promise<unknown>, code: string) => {
          await sql`savepoint rejected_operation`.execute(trx);
          try {
            await assert.rejects(run, { code });
          } finally {
            await sql`rollback to savepoint rejected_operation`.execute(trx);
            await sql`release savepoint rejected_operation`.execute(trx);
          }
        };
        // Prove failure without Auth does not materialize any product schema.
        await mustFail(() => up<Database>(trx), "P0001");
        const stillAbsent = await sql<{
          clear: boolean;
        }>`select to_regclass('public.profiles') is null as clear`.execute(trx);
        assert.equal(stillAbsent.rows[0]?.clear, true);

        // Minimal test double only; no credentials, password system or real Auth.
        await sql`create role anon nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role authenticated nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role service_role nologin nosuperuser bypassrls`.execute(trx);
        await sql`create schema auth`.execute(trx);
        await sql`create table auth.users (id uuid primary key)`.execute(trx);
        await sql`create function auth.uid() returns uuid language sql stable security invoker set search_path=pg_catalog
        as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$`.execute(
          trx,
        );
        await sql`revoke all on function auth.uid() from public`.execute(trx);
        await sql`grant usage on schema auth to authenticated`.execute(trx);
        await sql`grant execute on function auth.uid() to authenticated`.execute(trx);
        await sql`insert into auth.users(id) values (${a}),(${b})`.execute(trx);
        // Represent broad historical Supabase defaults; the migration must undo
        // them on profiles, without changing the default privileges themselves.
        await sql`alter default privileges in schema public grant all on tables to anon, authenticated, service_role`.execute(
          trx,
        );
        await up<Database>(trx);

        const security = await sql<{
          enabled: boolean;
          forced: boolean;
          definer: boolean;
          admin_only_schema: boolean;
          no_id_default: boolean;
          policy_count: number;
          checks: number;
        }>`select
        c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        (select prosecdef from pg_proc where oid='minepro_profile_internal.stamp_profile_update()'::regprocedure) as definer,
        not has_schema_privilege('authenticated','minepro_profile_internal','USAGE') as admin_only_schema,
        not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid=c.oid and a.attname='id') as no_id_default,
        (select count(*)::int from pg_policy where polrelid=c.oid) as policy_count,
        (select count(*)::int from pg_policy where polrelid=c.oid and polcmd in ('a','w') and polwithcheck is not null) as checks
        from pg_class c where c.oid='public.profiles'::regclass`.execute(trx);
        assert.deepEqual(security.rows[0], {
          enabled: true,
          forced: true,
          definer: false,
          admin_only_schema: true,
          no_id_default: true,
          policy_count: 3,
          checks: 2,
        });
        const grants = await sql<{
          anon_select: boolean;
          service_select: boolean;
          truncate: boolean;
          identity_update: boolean;
          timestamp_update: boolean;
          name_update: boolean;
        }>`select
        has_table_privilege('anon','public.profiles','SELECT') as anon_select,
        has_table_privilege('service_role','public.profiles','SELECT') as service_select,
        has_table_privilege('authenticated','public.profiles','TRUNCATE') as truncate,
        has_column_privilege('authenticated','public.profiles','id','UPDATE') as identity_update,
        has_column_privilege('authenticated','public.profiles','updated_at','UPDATE') as timestamp_update,
        has_column_privilege('authenticated','public.profiles','display_name','UPDATE') as name_update`.execute(
          trx,
        );
        assert.deepEqual(grants.rows[0], {
          anon_select: false,
          service_select: false,
          truncate: false,
          identity_update: false,
          timestamp_update: false,
          name_update: true,
        });

        const asUser = async (id: string | null, run: () => Promise<void>) => {
          await sql`set local role authenticated`.execute(trx);
          await sql`select set_config('request.jwt.claim.sub',${id ?? ""},true)`.execute(trx);
          await run();
          await sql`reset role`.execute(trx);
        };
        await asUser(a, async () => {
          await trx.insertInto("profiles").values({ id: a, display_name: "Player A" }).execute();
          await mustFail(
            () => trx.insertInto("profiles").values({ id: b, display_name: "Stolen B" }).execute(),
            "42501",
          );
          await mustFail(
            () => trx.insertInto("profiles").values({ id: a, display_name: "Duplicate" }).execute(),
            "23505",
          );
          await mustFail(
            () =>
              sql`insert into public.profiles(id,display_name,created_at) values (${a},'Spoofed',now())`.execute(
                trx,
              ),
            "42501",
          );
        });
        await asUser(b, async () => {
          await trx
            .insertInto("profiles")
            .values({ id: b, display_name: "Player B", preferences: { edition: "BEDROCK" } })
            .execute();
          const rows = await trx.selectFrom("profiles").selectAll().execute();
          assert.deepEqual(
            rows.map((row) => row.id),
            [b],
          );
          const update = await trx
            .updateTable("profiles")
            .set({ display_name: "Stolen" })
            .where("id", "=", a)
            .executeTakeFirst();
          assert.equal(update.numUpdatedRows, BigInt(0));
          await mustFail(
            () => sql`update public.profiles set id=${a} where id=${b}`.execute(trx),
            "42501",
          );
          await mustFail(
            () => sql`delete from public.profiles where id=${b}`.execute(trx),
            "42501",
          );
        });
        await asUser(null, async () => {
          assert.equal((await trx.selectFrom("profiles").selectAll().execute()).length, 0);
          await mustFail(
            () =>
              trx.insertInto("profiles").values({ id: a, display_name: "No session" }).execute(),
            "42501",
          );
        });
        await asUser(orphan, async () => {
          await mustFail(
            () =>
              trx
                .insertInto("profiles")
                .values({ id: orphan, display_name: "Missing Auth" })
                .execute(),
            "23503",
          );
        });
        await sql`set local role anon`.execute(trx);
        await mustFail(() => trx.selectFrom("profiles").selectAll().execute(), "42501");
        await sql`reset role`.execute(trx);
        await sql`set local role service_role`.execute(trx);
        await mustFail(() => trx.selectFrom("profiles").selectAll().execute(), "42501");
        await sql`reset role`.execute(trx);

        const initial = await trx
          .selectFrom("profiles")
          .selectAll()
          .where("id", "=", a)
          .executeTakeFirstOrThrow();
        assert.deepEqual(initial.preferences, {});
        assert.equal(initial.created_at.getTime(), initial.updated_at.getTime());
        for (const name of ["", " ", " Leading", "x".repeat(81)])
          await mustFail(
            () =>
              trx.updateTable("profiles").set({ display_name: name }).where("id", "=", a).execute(),
            "23514",
          );
        await mustFail(
          () => sql`update public.profiles set preferences='[]'::jsonb where id=${a}`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.profiles set preferences='null'::jsonb where id=${a}`.execute(trx),
          "23514",
        );
        await mustFail(
          () => sql`update public.profiles set preferences=null where id=${a}`.execute(trx),
          "23502",
        );
        await mustFail(
          () =>
            sql`insert into public.profiles(id,display_name) values ('invalid','Invalid')`.execute(
              trx,
            ),
          "22P02",
        );
        await mustFail(() => sql`delete from auth.users where id=${a}`.execute(trx), "23503");
        await mustFail(
          () => sql`update public.profiles set id=${orphan} where id=${a}`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.profiles set created_at=now()+interval '1 day' where id=${a}`.execute(
              trx,
            ),
          "23514",
        );
        await sql`select pg_sleep(0.02)`.execute(trx);
        await asUser(a, async () => {
          // No timestamp column grant: the invoker trigger supplies server time.
          await trx
            .updateTable("profiles")
            .set({ display_name: "Updated A", preferences: { edition: "JAVA" } })
            .where("id", "=", a)
            .execute();
        });
        const changed = await trx
          .selectFrom("profiles")
          .selectAll()
          .where("id", "=", a)
          .executeTakeFirstOrThrow();
        assert.equal(changed.created_at.getTime(), initial.created_at.getTime());
        assert.ok(changed.updated_at.getTime() > initial.updated_at.getTime());
        await trx
          .updateTable("profiles")
          .set({ display_name: "Backend", updated_at: updatedAt() })
          .where("id", "=", a)
          .execute();
        await sql`set local timezone to 'America/Sao_Paulo'`.execute(trx);
        assert.equal(
          toUtcTimestamp(
            (
              await trx
                .selectFrom("profiles")
                .selectAll()
                .where("id", "=", a)
                .executeTakeFirstOrThrow()
            ).created_at,
          ),
          toUtcTimestamp(initial.created_at),
        );

        await mustFail(() => down<Database>(trx), "P0001");
        assert.equal((await trx.selectFrom("profiles").selectAll().execute()).length, 2);
        await mustFail(() => up<Database>(trx), "42P06");
        // Synthetic fixtures only: safe rollback must refuse unrelated dependencies.
        await trx.deleteFrom("profiles").execute();
        await sql`create table minepro_profile_internal.unrelated_guard (value text)`.execute(trx);
        await mustFail(() => down<Database>(trx), "2BP01");
        assert.equal(
          (
            await sql<{
              present: boolean;
            }>`select to_regclass('public.profiles') is not null as present`.execute(trx)
          ).rows[0]?.present,
          true,
        );
        await sql`drop table minepro_profile_internal.unrelated_guard`.execute(trx);
        await down<Database>(trx);
        const removed = await sql<{
          absent: boolean;
          auth_count: number;
        }>`select to_regclass('public.profiles') is null and to_regnamespace('minepro_profile_internal') is null as absent, (select count(*)::int from auth.users) as auth_count`.execute(
          trx,
        );
        assert.deepEqual(removed.rows[0], { absent: true, auth_count: 2 });
        await up<Database>(trx);
        await down<Database>(trx);
        throw rollback;
      }),
      (error) => error === rollback,
    );
    const cleaned = await sql<{
      clean: boolean;
    }>`select to_regnamespace('auth') is null and to_regclass('public.profiles') is null and to_regnamespace('minepro_profile_internal') is null as clean`.execute(
      db,
    );
    assert.equal(cleaned.rows[0]?.clean, true);
  } finally {
    await db.destroy();
  }
});
