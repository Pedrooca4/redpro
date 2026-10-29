import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase } from "../../src/db/connection.ts";

test("PostgreSQL security: restrict EXECUTE, preserve RLS event trigger and reverse grants", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  const rollback = new Error("Rollback disposable security fixture");
  try {
    // The fixture needs a privileged owner to install an event trigger. No real
    // Supabase connection, env-file, migration runner or shared password is used.
    const preflight = await sql<{ privileged: boolean; collision: boolean }>`
      select (select rolsuper from pg_roles where rolname=current_user) as privileged,
        (to_regprocedure('public.rls_auto_enable()') is not null
         or exists(select 1 from pg_event_trigger where evtname='ensure_rls')
         or exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')))
        as collision
    `.execute(db);
    assert.equal(preflight.rows[0]?.privileged, true);
    assert.equal(preflight.rows[0]?.collision, false, "Refuse pre-existing objects or roles");
    const definition = await readFile(
      new URL("../fixtures/rls-auto-enable.sql", import.meta.url),
      "utf8",
    );

    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await sql`create role anon nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role authenticated nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role service_role nologin nosuperuser nobypassrls`.execute(trx);
        await sql.raw(definition).execute(trx);
        await sql`grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role`.execute(
          trx,
        );
        await sql`create event trigger ensure_rls on ddl_command_end
        when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
        execute function public.rls_auto_enable()`.execute(trx);

        const snapshot = async () =>
          (
            await sql<{
              definition: string;
              owner: string;
              settings: string[];
              trigger: string;
              tags: string[];
              enabled: string;
            }>`
        select pg_get_functiondef(p.oid) as definition, p.proowner::regrole::text as owner,
          p.proconfig as settings, e.evtname as trigger, e.evttags as tags, e.evtenabled as enabled
        from pg_proc p join pg_event_trigger e on e.evtfoid=p.oid
        where p.oid='public.rls_auto_enable()'::regprocedure
      `.execute(trx)
          ).rows[0];
        const privileges = async () =>
          (
            await sql<{
              public_execute: boolean;
              anon_execute: boolean;
              authenticated_execute: boolean;
              service_execute: boolean;
              owner_execute: boolean;
            }>`
        select exists(select 1 from pg_proc p,
          lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where p.oid='public.rls_auto_enable()'::regprocedure
          and a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,
          has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') as anon_execute,
          has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') as authenticated_execute,
          has_function_privilege('service_role','public.rls_auto_enable()','EXECUTE') as service_execute,
          has_function_privilege(current_user,'public.rls_auto_enable()','EXECUTE') as owner_execute
      `.execute(trx)
          ).rows[0];
        const baseline = await snapshot();
        assert.equal(baseline?.enabled, "O");
        const grants = await privileges();
        assert.deepEqual(grants, {
          public_execute: true,
          anon_execute: true,
          authenticated_execute: true,
          service_execute: true,
          owner_execute: true,
        });

        await sql`create table public.s2c_sentinel (id uuid primary key default gen_random_uuid(), created_at timestamptz(3) not null default now(), updated_at timestamptz(3) not null default now())`.execute(
          trx,
        );
        const sentinel = await sql<{
          id: string;
        }>`insert into public.s2c_sentinel default values returning id`.execute(trx);
        await sql`savepoint before_security_correction`.execute(trx);

        const correct = () =>
          sql`revoke execute on function public.rls_auto_enable() from public, anon, authenticated`.execute(
            trx,
          );
        await correct();
        const restricted = {
          public_execute: false,
          anon_execute: false,
          authenticated_execute: false,
          service_execute: true,
          owner_execute: true,
        };
        assert.deepEqual(await privileges(), restricted);
        assert.deepEqual(
          await snapshot(),
          baseline,
          "Definition, owner, search_path and event trigger unchanged",
        );
        await correct();
        assert.deepEqual(await privileges(), restricted, "Correction is idempotent");

        // A non-superuser DDL caller has no EXECUTE on the function. The existing
        // event trigger must still enable RLS with its privileged definer owner.
        await sql`grant usage, create on schema public to authenticated`.execute(trx);
        await sql`set local role authenticated`.execute(trx);
        await sql`create table public.s2c_after (value text)`.execute(trx);
        await sql`create table public.s2c_ctas as select 'synthetic'::text as value`.execute(trx);
        await sql`select 'synthetic'::text as value into public.s2c_select_into`.execute(trx);
        await sql`reset role`.execute(trx);
        const enabled = await sql<{
          name: string;
          enabled: boolean;
        }>`select relname as name, relrowsecurity as enabled from pg_class
        where oid in ('public.s2c_sentinel'::regclass,'public.s2c_after'::regclass,'public.s2c_ctas'::regclass,'public.s2c_select_into'::regclass) order by relname`.execute(
          trx,
        );
        assert.equal(enabled.rows.length, 4);
        assert.ok(
          enabled.rows.every((r) => r.enabled),
          "Every DDL variant enabled RLS",
        );
        await sql`grant usage on schema public to anon`.execute(trx);
        await sql`grant select on public.s2c_sentinel to anon`.execute(trx);
        await sql`set local role anon`.execute(trx);
        const hidden = await sql<{
          count: number;
        }>`select count(*)::int as count from public.s2c_sentinel`.execute(trx);
        assert.equal(hidden.rows[0]?.count, 0, "RLS denies rows without a policy");
        await sql`reset role`.execute(trx);
        assert.deepEqual(
          (await sql<{ id: string }>`select id from public.s2c_sentinel`.execute(trx)).rows,
          sentinel.rows,
        );

        // Verify the proposed post-commit reversal as well as transactional rollback.
        await sql`grant execute on function public.rls_auto_enable() to public, anon, authenticated`.execute(
          trx,
        );
        assert.deepEqual(await privileges(), grants);
        assert.deepEqual(await snapshot(), baseline);
        // Reversal restores the exact pre-change ACL via the transaction savepoint.
        // This also removes only the disposable post-savepoint fixtures by rollback.
        await sql`rollback to savepoint before_security_correction`.execute(trx);
        assert.deepEqual(await privileges(), grants);
        assert.deepEqual(await snapshot(), baseline);
        await sql`create table public.s2c_restored (value text)`.execute(trx);
        const restored = await sql<{
          enabled: boolean;
        }>`select relrowsecurity as enabled from pg_class where oid='public.s2c_restored'::regclass`.execute(
          trx,
        );
        assert.equal(restored.rows[0]?.enabled, true);
        throw rollback;
      }),
      (error) => error === rollback,
    );

    const clean = await sql<{ clean: boolean }>`select
      to_regprocedure('public.rls_auto_enable()') is null
      and to_regclass('public.s2c_sentinel') is null
      and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
      and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clean`.execute(
      db,
    );
    assert.equal(clean.rows[0]?.clean, true, "Full fixture rolled back");
  } finally {
    await db.destroy();
  }
});
