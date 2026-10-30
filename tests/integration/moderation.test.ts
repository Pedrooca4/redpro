import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase, type Database } from "../../src/db/connection.ts";
import { parseAuthUserId } from "../../src/db/profiles.ts";
import {
  newRecordId,
  parseRecordId,
  toUtcTimestamp,
  type RecordId,
} from "../../src/db/record-policy.ts";
import type { ReportStatus } from "../../src/db/moderation.ts";
import {
  up as profilesUp,
  down as profilesDown,
} from "../../src/db/migrations/20261029222313139_profiles.ts";
import {
  up as chatUp,
  down as chatDown,
} from "../../src/db/migrations/20261030153608225_conversations_messages.ts";
import {
  up as projectsUp,
  down as projectsDown,
} from "../../src/db/migrations/20261030162454631_projects.ts";
import {
  up as communityUp,
  down as communityDown,
} from "../../src/db/migrations/20261030193224693_community.ts";
import { up, down } from "../../src/db/migrations/20261030202411736_reports_moderation.ts";

test("PostgreSQL reports: confidential receipts, no moderator escalation, atomic append-only audit and safe reversal", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  const rollback = new Error("Rollback RED-017 disposable fixture");
  const a = parseAuthUserId("c301fc1a-44f5-4140-b786-4965af4a1dad");
  const b = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
  const missing = newRecordId();
  try {
    await sql`select 1`.execute(db);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        const absent = await sql<{ clear: boolean }>`select to_regnamespace('auth') is null
        and to_regclass('public.profiles') is null and to_regclass('public.posts') is null
        and to_regclass('public.reports') is null and to_regclass('public.moderation') is null
        and to_regnamespace('minepro_moderation_internal') is null
        and to_regprocedure('public.rls_auto_enable()') is null
        and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
        and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clear`.execute(
          trx,
        );
        assert.equal(absent.rows[0]?.clear, true, "Refuse existing product data or real Auth");
        const mustFail = async (run: () => Promise<unknown>, code: string) => {
          await sql`savepoint rejected_report_operation`.execute(trx);
          try {
            await assert.rejects(run, { code });
          } finally {
            await sql`rollback to savepoint rejected_report_operation`.execute(trx);
            await sql`release savepoint rejected_report_operation`.execute(trx);
          }
        };
        const asRole = async (
          role: "authenticated" | "anon" | "service_role",
          id: string | null,
          run: () => Promise<void>,
        ) => {
          await sql`savepoint report_role_scope`.execute(trx);
          try {
            await sql`set local role ${sql.id(role)}`.execute(trx);
            await sql`select set_config('request.jwt.claim.sub',${id ?? ""},true)`.execute(trx);
            await run();
          } catch (error) {
            await sql`rollback to savepoint report_role_scope`.execute(trx);
            await sql`release savepoint report_role_scope`.execute(trx);
            throw error;
          }
          await sql`reset role`.execute(trx);
          await sql`release savepoint report_role_scope`.execute(trx);
        };
        await mustFail(() => up<Database>(trx), "P0001");
        await sql`create role anon nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role authenticated nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role service_role nologin nosuperuser bypassrls`.execute(trx);
        await sql`create schema auth`.execute(trx);
        await sql`create table auth.users(id uuid primary key)`.execute(trx);
        await sql`create function auth.uid() returns uuid language sql stable security invoker set search_path=pg_catalog as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$`.execute(
          trx,
        );
        await sql`revoke all on function auth.uid() from public`.execute(trx);
        await sql`grant usage on schema auth to authenticated`.execute(trx);
        await sql`grant execute on function auth.uid() to authenticated`.execute(trx);
        await sql`insert into auth.users(id) values (${a}),(${b})`.execute(trx);
        await profilesUp<Database>(trx);
        await trx
          .insertInto("profiles")
          .values([
            { id: a, display_name: "Synthetic A" },
            { id: b, display_name: "Synthetic B" },
          ])
          .execute();
        await chatUp<Database>(trx);
        await projectsUp<Database>(trx);
        await mustFail(() => up<Database>(trx), "P0001"); // RED-016 must exist first.
        await communityUp<Database>(trx);
        const post = async (owner_id: typeof a) =>
          trx
            .insertInto("posts")
            .values({
              owner_id,
              title: "Private fixture",
              content: "Synthetic",
              domain: "RED",
              category: "test",
              edition: "JAVA",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        const pa = await post(a),
          pb = await post(b);
        const ca = await trx
          .insertInto("comments")
          .values({ owner_id: a, post_id: pa.id, content: "Synthetic A" })
          .returningAll()
          .executeTakeFirstOrThrow();
        const cb = await trx
          .insertInto("comments")
          .values({ owner_id: b, post_id: pb.id, content: "Synthetic B" })
          .returningAll()
          .executeTakeFirstOrThrow();
        const hiddenComment = await trx
          .insertInto("comments")
          .values({ owner_id: a, post_id: pb.id, content: "Privileged malformed fixture" })
          .returningAll()
          .executeTakeFirstOrThrow();
        await sql
          .raw(await readFile(new URL("../fixtures/rls-auto-enable.sql", import.meta.url), "utf8"))
          .execute(trx);
        await sql`revoke execute on function public.rls_auto_enable() from public,anon,authenticated`.execute(
          trx,
        );
        await sql`create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function public.rls_auto_enable()`.execute(
          trx,
        );
        await sql`alter default privileges in schema public grant all on tables to anon,authenticated,service_role`.execute(
          trx,
        );
        const snapshot = async () =>
          (
            await sql<{ state: unknown }>`select jsonb_build_object(
        'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'owner',c.relowner) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname not in ('reports','moderation')),
        'columns',(select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl) order by c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname not in ('reports','moderation') and a.attnum>0),
        'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public' and tablename not in ('reports','moderation')),
        'functions',(select jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','minepro_profile_internal','minepro_chat_internal','minepro_project_internal','minepro_community_internal') or p.oid='public.rls_auto_enable()'::regprocedure),
        'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname not in ('reports','moderation')),
        'event',(select to_jsonb(e) from pg_event_trigger e where evtname='ensure_rls'),
        'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d)
      ) as state`.execute(trx)
          ).rows[0]?.state;
        const before = await snapshot();
        await up<Database>(trx);
        assert.deepEqual(
          await snapshot(),
          before,
          "Earlier private content, security objects and grants preserved",
        );
        const catalog = await sql<{
          enabled: number;
          forced: number;
          policies: number;
          audit_policies: number;
          fk: number;
          indexes: number;
          definers: number;
        }>`select
        (select count(*)::int from pg_class where oid in ('public.reports'::regclass,'public.moderation'::regclass) and relrowsecurity) as enabled,
        (select count(*)::int from pg_class where oid in ('public.reports'::regclass,'public.moderation'::regclass) and relforcerowsecurity) as forced,
        (select count(*)::int from pg_policies where schemaname='public' and tablename='reports') as policies,
        (select count(*)::int from pg_policies where schemaname='public' and tablename='moderation') as audit_policies,
        (select count(*)::int from pg_constraint where contype='f' and conrelid in ('public.reports'::regclass,'public.moderation'::regclass)) as fk,
        (select count(*)::int from pg_indexes where schemaname='public' and tablename in ('reports','moderation')) as indexes,
        (select count(*)::int from pg_proc where pronamespace='minepro_moderation_internal'::regnamespace and prosecdef) as definers`.execute(
          trx,
        );
        assert.deepEqual(catalog.rows[0], {
          enabled: 2,
          forced: 2,
          policies: 2,
          audit_policies: 0,
          fk: 5,
          indexes: 8,
          definers: 0,
        });
        for (const role of ["anon", "authenticated", "service_role"])
          assert.equal(
            (
              await sql<{
                allowed: boolean;
              }>`select has_table_privilege(${role},'public.moderation','SELECT,INSERT,UPDATE,DELETE') as allowed`.execute(
                trx,
              )
            ).rows[0]?.allowed,
            false,
          );
        for (const role of ["anon", "service_role"])
          assert.equal(
            (
              await sql<{
                allowed: boolean;
              }>`select has_table_privilege(${role},'public.reports','SELECT,INSERT,UPDATE,DELETE') as allowed`.execute(
                trx,
              )
            ).rows[0]?.allowed,
            false,
          );
        assert.equal(
          (
            await sql<{
              allowed: boolean;
            }>`select has_schema_privilege('authenticated','minepro_moderation_internal','USAGE') or has_function_privilege('authenticated','minepro_moderation_internal.apply_moderation()','EXECUTE') as allowed`.execute(
              trx,
            )
          ).rows[0]?.allowed,
          false,
        );
        await mustFail(() => up<Database>(trx), "42P06");
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        await up<Database>(trx);
        await sql`set local row_security=on`.execute(trx);
        await sql`savepoint report_data`.execute(trx);
        const report = (
          reporter_id: typeof a,
          post_id: RecordId | null,
          comment_id: RecordId | null,
        ) =>
          trx
            .insertInto("reports")
            .values({
              reporter_id,
              post_id,
              comment_id,
              reason: "Synthetic reason",
              details: "Synthetic private details",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        let ra!: Awaited<ReturnType<typeof report>>,
          rc!: Awaited<ReturnType<typeof report>>,
          rb!: Awaited<ReturnType<typeof report>>;
        await asRole("authenticated", a, async () => {
          ra = await report(a, pa.id, null);
          rc = await report(a, null, ca.id);
          for (const run of [
            () => report(b, pa.id, null),
            () => report(a, pb.id, null),
            () => report(a, null, cb.id),
            () => report(a, null, hiddenComment.id),
            () => report(a, missing, null),
            () => report(a, null, missing),
          ])
            await mustFail(run, "42501");
          for (const assignment of [
            sql`status='resolved'`,
            sql`revision=1`,
            sql`reporter_id=${b}`,
            sql`reason='Rewrite'`,
            sql`id=${missing}`,
            sql`created_at=now()`,
            sql`updated_at=now()`,
          ])
            await mustFail(
              () => sql`update public.reports set ${assignment} where id=${ra.id}`.execute(trx),
              "42501",
            );
          await mustFail(
            () =>
              sql`insert into public.reports(reporter_id,post_id,reason,status) values (${a},${pa.id},'Fake','open')`.execute(
                trx,
              ),
            "42501",
          );
          await mustFail(() => trx.deleteFrom("reports").execute(), "42501");
          await mustFail(() => sql`truncate public.reports`.execute(trx), "42501");
        });
        await asRole("authenticated", b, async () => {
          rb = await report(b, pb.id, null);
        });
        // Simulate a future authorized submission about A, without opening A's post.
        const confidential = await report(b, pa.id, null);
        assert.equal(parseRecordId(ra.id), ra.id);
        assert.equal(ra.status, "open");
        assert.equal(rc.comment_id, ca.id);
        assert.equal(rc.post_id, null);
        assert.equal(ra.revision, 0);
        assert.equal(ra.created_at.getTime(), ra.updated_at.getTime());
        assert.equal(rb.reporter_id, b);
        const audit = (
          report_id: RecordId,
          sequence: number,
          from: ReportStatus,
          to: ReportStatus,
          actor: typeof a = b,
          note = "Synthetic internal decision",
        ) =>
          sql<{
            id: RecordId;
            created_at: Date;
            updated_at: Date;
            actor_id: typeof a;
          }>`insert into public.moderation(report_id,actor_id,sequence,from_status,to_status,note) values (${report_id},${actor},${sequence},${from},${to},${note}) returning id,created_at,updated_at,actor_id`.execute(
            trx,
          );
        for (const who of [a, b])
          await asRole("authenticated", who, async () => {
            await trx
              .updateTable("profiles")
              .set({ preferences: { role: "moderator", is_admin: true } })
              .where("id", "=", who)
              .execute();
            await mustFail(() => trx.selectFrom("moderation").selectAll().execute(), "42501");
            await mustFail(() => audit(ra.id, 1, "open", "in_review", who), "42501");
            await mustFail(
              () => sql`update public.moderation set note='Fake'`.execute(trx),
              "42501",
            );
            await mustFail(() => sql`delete from public.moderation`.execute(trx), "42501");
            await mustFail(
              () => sql`select minepro_moderation_internal.apply_moderation()`.execute(trx),
              "42501",
            );
            assert.equal(
              (
                await trx
                  .selectFrom("reports")
                  .selectAll()
                  .where("id", "=", who === a ? confidential.id : ra.id)
                  .execute()
              ).length,
              0,
            );
          });
        await asRole("authenticated", null, async () => {
          assert.equal((await trx.selectFrom("reports").selectAll().execute()).length, 0);
          await mustFail(() => report(a, pa.id, null), "42501");
        });
        for (const role of ["anon", "service_role"] as const)
          await asRole(role, null, async () => {
            await mustFail(() => trx.selectFrom("reports").selectAll().execute(), "42501");
            await mustFail(() => trx.selectFrom("moderation").selectAll().execute(), "42501");
            await mustFail(() => report(a, pa.id, null), "42501");
            await mustFail(() => audit(ra.id, 1, "open", "in_review"), "42501");
          });
        await mustFail(() => report(a, null, null), "23514");
        await mustFail(() => report(a, pa.id, ca.id), "23514");
        await mustFail(() => report(parseAuthUserId(missing), pa.id, null), "23503");
        await mustFail(() => report(a, missing, null), "23503");
        await mustFail(() => report(a, null, missing), "23503");
        for (const statement of [
          sql`insert into public.reports(id,reporter_id,post_id,reason) values (${b},${a},${pa.id},'Non-v4')`,
          sql`insert into public.reports(reporter_id,post_id,reason,status) values (${a},${pa.id},'Invalid','resolved')`,
          sql`insert into public.reports(reporter_id,post_id,reason,revision) values (${a},${pa.id},'Invalid',1)`,
          sql`insert into public.reports(reporter_id,post_id,reason) values (${a},${pa.id},'')`,
          sql`insert into public.reports(reporter_id,post_id,reason) values (${a},${pa.id},${"x".repeat(161)})`,
          sql`insert into public.reports(reporter_id,post_id,reason,details) values (${a},${pa.id},'Invalid',${"x".repeat(8193)})`,
        ])
          await mustFail(() => statement.execute(trx), "23514");
        for (const assignment of [
          sql`reporter_id=${b}`,
          sql`post_id=${pb.id}`,
          sql`reason='Rewrite'`,
          sql`details='Rewrite'`,
          sql`created_at=now()+interval '1 day'`,
          sql`id=${missing}`,
          sql`status='resolved'`,
          sql`revision=1`,
        ])
          await mustFail(
            () => sql`update public.reports set ${assignment} where id=${ra.id}`.execute(trx),
            "23514",
          );
        await mustFail(() => trx.deleteFrom("reports").where("id", "=", ra.id).execute(), "23514");
        await sql`select pg_sleep(0.02)`.execute(trx);
        const first = (await audit(ra.id, 1, "open", "in_review")).rows[0]!;
        assert.equal(first.actor_id, b);
        assert.equal(parseRecordId(first.id), first.id);
        assert.equal(first.created_at.getTime(), first.updated_at.getTime());
        const receipt = () =>
          trx.selectFrom("reports").selectAll().where("id", "=", ra.id).executeTakeFirstOrThrow();
        let current = await receipt();
        assert.equal(current.status, "in_review");
        assert.equal(current.revision, 1);
        assert.ok(current.updated_at.getTime() > ra.updated_at.getTime());
        await sql`select pg_sleep(0.02)`.execute(trx);
        await audit(ra.id, 2, "in_review", "resolved");
        current = await receipt();
        assert.equal(current.status, "resolved");
        assert.equal(current.revision, 2);
        // Every rejected event must leave both audit and status untouched.
        for (const run of [
          () => audit(ra.id, 1, "open", "in_review"),
          () => audit(ra.id, 4, "resolved", "open"),
          () => audit(ra.id, 3, "open", "in_review"),
          () => audit(ra.id, 3, "resolved", "in_review"),
          () => audit(ra.id, 3, "resolved", "resolved"),
          () => audit(ra.id, 3, "resolved", "open", b, ""),
          () => audit(ra.id, 3, "resolved", "open", b, "x".repeat(8193)),
        ])
          await mustFail(run, "23514");
        await mustFail(
          () => audit(ra.id, 3, "resolved", "open", parseAuthUserId(missing)),
          "23503",
        );
        await mustFail(() => audit(missing, 1, "open", "in_review"), "42501");
        await mustFail(
          () =>
            sql`insert into public.moderation(id,report_id,actor_id,sequence,from_status,to_status,note) values (${b},${ra.id},${b},3,'resolved','open','Non-v4')`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`insert into public.moderation(id,report_id,actor_id,sequence,from_status,to_status,note) values (${first.id},${ra.id},${b},3,'resolved','open','Duplicate ID')`.execute(
              trx,
            ),
          "23505",
        );
        assert.equal((await receipt()).status, "resolved");
        assert.equal((await receipt()).revision, 2);
        assert.equal((await trx.selectFrom("moderation").selectAll().execute()).length, 2);
        await audit(ra.id, 3, "resolved", "open");
        await audit(ra.id, 4, "open", "dismissed");
        await audit(ra.id, 5, "dismissed", "open");
        await audit(ra.id, 6, "open", "in_review");
        await audit(ra.id, 7, "in_review", "open");
        assert.deepEqual(
          (
            await trx
              .selectFrom("moderation")
              .select("sequence")
              .where("report_id", "=", ra.id)
              .orderBy("sequence")
              .execute()
          ).map((x) => x.sequence),
          [1, 2, 3, 4, 5, 6, 7],
        );
        await asRole("authenticated", a, async () => {
          const own = await receipt();
          assert.equal(own.status, "open");
          assert.equal(own.revision, 7);
          assert.equal((await trx.selectFrom("reports").selectAll().execute()).length, 2);
          await mustFail(() => trx.selectFrom("moderation").selectAll().execute(), "42501");
        });
        // Demonstrate the audit's default-deny RLS even with accidental SELECT.
        await sql`savepoint accidental_audit_grant`.execute(trx);
        await sql`grant select on public.moderation to authenticated`.execute(trx);
        for (const who of [a, b])
          await asRole("authenticated", who, async () => {
            assert.equal((await trx.selectFrom("moderation").selectAll().execute()).length, 0);
          });
        await sql`rollback to savepoint accidental_audit_grant`.execute(trx);
        await sql`release savepoint accidental_audit_grant`.execute(trx);
        for (const assignment of [
          sql`actor_id=${a}`,
          sql`note='Rewrite'`,
          sql`sequence=9`,
          sql`updated_at=now()`,
        ])
          await mustFail(
            () => sql`update public.moderation set ${assignment} where id=${first.id}`.execute(trx),
            "23514",
          );
        await mustFail(
          () => sql`delete from public.moderation where id=${first.id}`.execute(trx),
          "23514",
        );
        await mustFail(() => sql`truncate public.moderation`.execute(trx), "23514");
        await mustFail(() => sql`truncate public.reports,public.moderation`.execute(trx), "23514");
        await sql`savepoint atomic_audit_rollback`.execute(trx);
        await audit(ra.id, 8, "open", "resolved");
        assert.equal((await receipt()).revision, 8);
        await sql`rollback to savepoint atomic_audit_rollback`.execute(trx);
        await sql`release savepoint atomic_audit_rollback`.execute(trx);
        assert.equal((await receipt()).revision, 7);
        assert.equal((await receipt()).status, "open");
        assert.equal((await trx.selectFrom("moderation").selectAll().execute()).length, 7);
        await sql`set local timezone to 'America/Sao_Paulo'`.execute(trx);
        assert.equal(toUtcTimestamp((await receipt()).created_at), toUtcTimestamp(ra.created_at));
        assert.equal(
          (
            await trx
              .selectFrom("posts")
              .selectAll()
              .where("id", "=", pa.id)
              .executeTakeFirstOrThrow()
          ).publication_status,
          "draft",
        );
        assert.equal((await trx.selectFrom("comments").selectAll().execute()).length, 3);
        await mustFail(() => down<Database>(trx), "P0001");
        await mustFail(() => trx.deleteFrom("profiles").where("id", "=", b).execute(), "23503");
        // Remove only synthetic changes via savepoint rollback, never DELETE audit.
        await sql`rollback to savepoint report_data`.execute(trx);
        await sql`release savepoint report_data`.execute(trx);
        assert.equal((await trx.selectFrom("reports").selectAll().execute()).length, 0);
        assert.equal((await trx.selectFrom("moderation").selectAll().execute()).length, 0);
        await sql`create view public.unrelated_report_view as select id from public.reports`.execute(
          trx,
        );
        await mustFail(() => down<Database>(trx), "2BP01");
        await sql`drop view public.unrelated_report_view`.execute(trx);
        await sql`comment on table public.moderation is 'Unrelated identity'`.execute(trx);
        await mustFail(() => down<Database>(trx), "P0001");
        await sql`comment on table public.moderation is 'MinePRO RED-017 audit v1'`.execute(trx);
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        await up<Database>(trx);
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        await trx.deleteFrom("comments").execute();
        await trx.deleteFrom("posts").execute();
        await communityDown<Database>(trx);
        await projectsDown<Database>(trx);
        await chatDown<Database>(trx);
        await trx.deleteFrom("profiles").execute();
        await profilesDown<Database>(trx);
        assert.equal(
          (await sql<{ count: number }>`select count(*)::int as count from auth.users`.execute(trx))
            .rows[0]?.count,
          2,
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
    const cleaned = await sql<{ clear: boolean }>`select to_regnamespace('auth') is null
      and to_regclass('public.reports') is null and to_regclass('public.moderation') is null
      and to_regnamespace('minepro_moderation_internal') is null and to_regclass('public.posts') is null
      and to_regclass('public.profiles') is null and to_regprocedure('public.rls_auto_enable()') is null
      and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
      and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clear`.execute(
      db,
    );
    assert.equal(cleaned.rows[0]?.clear, true);
  } finally {
    await db.destroy();
  }
});
