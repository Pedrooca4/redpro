import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import { readDevelopmentDatabaseConfig } from "../../src/config/database.ts";
import { createDevelopmentDatabase, type Database } from "../../src/db/connection.ts";
import { parseAuthUserId } from "../../src/db/profiles.ts";
import { newRecordId, parseRecordId, toUtcTimestamp } from "../../src/db/record-policy.ts";
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
import { up, down } from "../../src/db/migrations/20261030193224693_community.ts";

test("PostgreSQL community: private ownership, typed targets, uniqueness, least privilege and safe reversal", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  const rollback = new Error("Rollback RED-016 disposable fixture");
  const a = parseAuthUserId("c301fc1a-44f5-4140-b786-4965af4a1dad");
  const b = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
  const missing = newRecordId();
  const tables = ["posts", "comments", "reactions", "favorites"] as const;
  try {
    await sql`select 1`.execute(db);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        const absent = await sql<{ clear: boolean }>`select to_regnamespace('auth') is null
        and to_regclass('public.profiles') is null and to_regclass('public.projects') is null
        and to_regclass('public.conversations') is null and to_regclass('public.messages') is null
        and to_regnamespace('minepro_community_internal') is null
        and to_regprocedure('public.rls_auto_enable()') is null
        and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
        and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role'))
        and not exists(select 1 from pg_tables where schemaname='public' and tablename in ('posts','comments','reactions','favorites')) as clear`.execute(
          trx,
        );
        assert.equal(absent.rows[0]?.clear, true, "Refuse existing data or real Auth");
        const mustFail = async (run: () => Promise<unknown>, code: string) => {
          await sql`savepoint rejected_community_operation`.execute(trx);
          try {
            await assert.rejects(run, { code });
          } finally {
            await sql`rollback to savepoint rejected_community_operation`.execute(trx);
            await sql`release savepoint rejected_community_operation`.execute(trx);
          }
        };
        const asRole = async (
          role: "authenticated" | "anon" | "service_role",
          id: string | null,
          run: () => Promise<void>,
        ) => {
          await sql`savepoint community_role_scope`.execute(trx);
          try {
            await sql`set local role ${sql.id(role)}`.execute(trx);
            await sql`select set_config('request.jwt.claim.sub',${id ?? ""},true)`.execute(trx);
            await run();
          } catch (error) {
            await sql`rollback to savepoint community_role_scope`.execute(trx);
            await sql`release savepoint community_role_scope`.execute(trx);
            throw error;
          }
          await sql`reset role`.execute(trx);
          await sql`release savepoint community_role_scope`.execute(trx);
        };
        await mustFail(() => up<Database>(trx), "P0001");
        await sql`create role anon nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role authenticated nologin nosuperuser nobypassrls`.execute(trx);
        await sql`create role service_role nologin nosuperuser bypassrls`.execute(trx);
        await sql`create schema auth`.execute(trx);
        await sql`create table auth.users(id uuid primary key)`.execute(trx);
        await sql`create function auth.uid() returns uuid language sql stable security invoker set search_path=pg_catalog
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$`.execute(trx);
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
        await mustFail(() => up<Database>(trx), "P0001"); // No skipping RED-015.
        await projectsUp<Database>(trx);
        const project = (owner_id: typeof a) =>
          trx
            .insertInto("projects")
            .values({
              owner_id,
              title: "Private project",
              description: "Synthetic",
              domain: "RED",
              category: "circuit",
              edition: "JAVA",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        const projectA = await project(a);
        const projectB = await project(b);
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
        'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'owner',c.relowner) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','conversations','messages','projects','project_steps','materials')),
        'columns',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'acl',a.attacl) order by c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relname in ('profiles','conversations','messages','projects','project_steps','materials') and a.attnum>0),
        'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public' and tablename not in ('posts','comments','reactions','favorites')),
        'functions',(select jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','minepro_profile_internal','minepro_chat_internal','minepro_project_internal') or p.oid='public.rls_auto_enable()'::regprocedure),
        'event',(select to_jsonb(e) from pg_event_trigger e where evtname='ensure_rls'),
        'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in ('profiles','conversations','messages','projects','project_steps','materials')),
        'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d)
      ) as state`.execute(trx)
          ).rows[0]?.state;
        const before = await snapshot();
        await up<Database>(trx);
        assert.deepEqual(
          await snapshot(),
          before,
          "Earlier security, column grants and default ACLs preserved",
        );
        const catalog = await sql<{
          enabled: number;
          forced: number;
          policies: number;
          fk: number;
          definers: number;
          indexes: number;
        }>`select
        (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname in ('posts','comments','reactions','favorites') and relrowsecurity) as enabled,
        (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname in ('posts','comments','reactions','favorites') and relforcerowsecurity) as forced,
        (select count(*)::int from pg_policies where schemaname='public' and tablename in ('posts','comments','reactions','favorites')) as policies,
        (select count(*)::int from pg_constraint where contype='f' and conrelid in ('public.posts'::regclass,'public.comments'::regclass,'public.reactions'::regclass,'public.favorites'::regclass)) as fk,
        (select count(*)::int from pg_proc where pronamespace='minepro_community_internal'::regnamespace and prosecdef) as definers,
        (select count(*)::int from pg_indexes where schemaname='public' and tablename in ('posts','comments','reactions','favorites')) as indexes`.execute(
          trx,
        );
        assert.deepEqual(catalog.rows[0], {
          enabled: 4,
          forced: 4,
          policies: 12,
          fk: 8,
          definers: 0,
          indexes: 14,
        });
        for (const table of tables)
          for (const column of ["id", "owner_id", "created_at", "updated_at"])
            assert.equal(
              (
                await sql<{
                  allowed: boolean;
                }>`select has_column_privilege('authenticated',${"public." + table},${column},'UPDATE') as allowed`.execute(
                  trx,
                )
              ).rows[0]?.allowed,
              false,
            );
        for (const role of ["anon", "service_role"])
          for (const table of tables)
            assert.equal(
              (
                await sql<{
                  allowed: boolean;
                }>`select has_table_privilege(${role},${"public." + table},'SELECT') as allowed`.execute(
                  trx,
                )
              ).rows[0]?.allowed,
              false,
            );
        assert.equal(
          (
            await sql<{
              allowed: boolean;
            }>`select has_schema_privilege('authenticated','minepro_community_internal','USAGE') or has_function_privilege('authenticated','minepro_community_internal.guard_community_update()','EXECUTE') as allowed`.execute(
              trx,
            )
          ).rows[0]?.allowed,
          false,
        );
        await mustFail(() => up<Database>(trx), "42P06");
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        await up<Database>(trx);
        // The fixture reuses down's transaction; the real runner commits it.
        await sql`set local row_security=on`.execute(trx);
        const post = (owner_id: typeof a) =>
          trx
            .insertInto("posts")
            .values({
              owner_id,
              title: "Private post",
              content: "Synthetic text",
              domain: "BUILDER",
              category: "build",
              edition: "JAVA",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        let pa!: Awaited<ReturnType<typeof post>>;
        let pb!: Awaited<ReturnType<typeof post>>;
        await asRole("authenticated", a, async () => {
          pa = await post(a);
          await mustFail(() => post(b), "42501");
        });
        await asRole("authenticated", b, async () => {
          pb = await post(b);
        });
        assert.equal(parseRecordId(pa.id), pa.id);
        assert.equal(pa.visibility, "private");
        assert.equal(pa.publication_status, "draft");
        assert.equal(pa.game_version, null);
        assert.equal(pb.owner_id, b); // Auth UUID v7 retained.
        const comment = (owner_id: typeof a, post_id: typeof pa.id) =>
          trx
            .insertInto("comments")
            .values({ owner_id, post_id, content: "Private comment" })
            .returningAll()
            .executeTakeFirstOrThrow();
        const react = (owner_id: typeof a, post_id: typeof pa.id) =>
          trx
            .insertInto("reactions")
            .values({ owner_id, post_id })
            .returningAll()
            .executeTakeFirstOrThrow();
        const favoritePost = (owner_id: typeof a, post_id: typeof pa.id) =>
          trx
            .insertInto("favorites")
            .values({ owner_id, post_id })
            .returningAll()
            .executeTakeFirstOrThrow();
        const favoriteProject = (owner_id: typeof a, project_id: typeof projectA.id) =>
          trx
            .insertInto("favorites")
            .values({ owner_id, project_id })
            .returningAll()
            .executeTakeFirstOrThrow();
        let ca!: Awaited<ReturnType<typeof comment>>;
        let ra!: Awaited<ReturnType<typeof react>>;
        let fa!: Awaited<ReturnType<typeof favoritePost>>;
        let fp!: Awaited<ReturnType<typeof favoriteProject>>;
        await asRole("authenticated", a, async () => {
          ca = await comment(a, pa.id);
          ra = await react(a, pa.id);
          fa = await favoritePost(a, pa.id);
          fp = await favoriteProject(a, projectA.id);
          assert.equal(ra.kind, "like");
          await mustFail(() => react(a, pa.id), "23505");
          await mustFail(() => favoritePost(a, pa.id), "23505");
          await mustFail(() => favoriteProject(a, projectA.id), "23505");
          for (const run of [
            () => comment(a, pb.id),
            () => comment(b, pa.id),
            () => react(a, pb.id),
            () => react(b, pa.id),
            () => favoritePost(a, pb.id),
            () => favoritePost(b, pa.id),
            () => favoriteProject(a, projectB.id),
          ])
            await mustFail(run, "42501");
          for (const run of [
            () => comment(a, missing),
            () => react(a, missing),
            () => favoritePost(a, missing),
            () => favoriteProject(a, missing),
          ])
            await mustFail(run, "42501");
          for (const assignment of [
            sql`owner_id=${b}`,
            sql`id=${missing}`,
            sql`visibility='public'`,
            sql`publication_status='published'`,
            sql`created_at=now()`,
            sql`updated_at=now()`,
          ])
            await mustFail(
              () => sql`update public.posts set ${assignment} where id=${pa.id}`.execute(trx),
              "42501",
            );
          await mustFail(
            () =>
              sql`insert into public.posts(owner_id,title,content,domain,category,edition,publication_status) values (${a},'Fake','x','RED','test','JAVA','draft')`.execute(
                trx,
              ),
            "42501",
          );
          await mustFail(
            () => sql`update public.comments set post_id=${pb.id} where id=${ca.id}`.execute(trx),
            "42501",
          );
          await mustFail(
            () => sql`update public.reactions set kind='like' where id=${ra.id}`.execute(trx),
            "42501",
          );
          await mustFail(
            () =>
              sql`update public.favorites set project_id=${projectB.id} where id=${fp.id}`.execute(
                trx,
              ),
            "42501",
          );
          for (const table of ["posts", "comments"] as const)
            await mustFail(() => trx.deleteFrom(table).execute(), "42501");
          await mustFail(() => sql`truncate public.reactions`.execute(trx), "42501");
        });
        for (const row of [ca, ra, fa, fp]) {
          assert.equal(parseRecordId(row.id), row.id);
          assert.equal(row.created_at.getTime(), row.updated_at.getTime());
        }
        // Even privileged malformed fixtures cannot be read by merely owning the child.
        await comment(b, pa.id);
        await asRole("authenticated", b, async () => {
          assert.deepEqual(
            (await trx.selectFrom("posts").selectAll().execute()).map((x) => x.id),
            [pb.id],
          );
          for (const table of ["comments", "reactions", "favorites"] as const)
            assert.equal((await trx.selectFrom(table).selectAll().execute()).length, 0);
          assert.equal(
            (
              await trx
                .updateTable("posts")
                .set({ content: "Stolen" })
                .where("id", "=", pa.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
          assert.equal(
            (
              await trx
                .updateTable("comments")
                .set({ content: "Stolen" })
                .where("id", "=", ca.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
          for (const table of ["reactions", "favorites"] as const)
            assert.equal(
              (await trx.deleteFrom(table).executeTakeFirst()).numDeletedRows,
              BigInt(0),
            );
          await comment(b, pb.id);
          await react(b, pb.id);
          await favoritePost(b, pb.id);
          await favoriteProject(b, projectB.id);
        });
        await asRole("authenticated", null, async () => {
          for (const table of tables)
            assert.equal((await trx.selectFrom(table).selectAll().execute()).length, 0);
          for (const run of [
            () => post(a),
            () => comment(a, pa.id),
            () => react(a, pa.id),
            () => favoritePost(a, pa.id),
          ])
            await mustFail(run, "42501");
        });
        for (const role of ["anon", "service_role"] as const)
          await asRole(role, null, async () => {
            for (const table of tables)
              await mustFail(() => trx.selectFrom(table).selectAll().execute(), "42501");
            for (const run of [
              () => post(a),
              () => comment(a, pa.id),
              () => react(a, pa.id),
              () => favoritePost(a, pa.id),
            ])
              await mustFail(run, "42501");
          });
        // Native integrity remains independently enforced for trusted SQL too.
        for (const insert of [
          sql`insert into public.posts(id,owner_id,title,content,domain,category,edition) values (${b},${a},'Non-v4','Synthetic','RED','test','JAVA')`,
          sql`insert into public.comments(id,owner_id,post_id,content) values (${b},${a},${pa.id},'Non-v4')`,
          sql`insert into public.reactions(id,owner_id,post_id) values (${b},${b},${pa.id})`,
          sql`insert into public.favorites(id,owner_id,post_id) values (${b},${b},${pa.id})`,
        ])
          await mustFail(() => insert.execute(trx), "23514");
        await mustFail(() => post(parseAuthUserId(missing)), "23503");
        await mustFail(() => comment(a, missing), "23503");
        await mustFail(() => react(a, missing), "23503");
        await mustFail(() => favoritePost(a, missing), "23503");
        await mustFail(() => favoriteProject(a, missing), "23503");
        await mustFail(
          () => trx.insertInto("favorites").values({ owner_id: a }).execute(),
          "23514",
        );
        await mustFail(
          () =>
            trx
              .insertInto("favorites")
              .values({ owner_id: a, post_id: pa.id, project_id: projectA.id })
              .execute(),
          "23514",
        );
        for (const [column, value] of [
          ["title", ""],
          ["title", " " + "x"],
          ["title", "x".repeat(161)],
          ["content", " "],
          ["content", "x".repeat(65537)],
          ["domain", "ADMIN"],
          ["category", "Bad Category"],
          ["edition", "POCKET"],
          ["game_version", " "],
          ["game_version", "x".repeat(65)],
          ["visibility", "public"],
          ["publication_status", "published"],
        ] as const)
          await mustFail(
            () =>
              sql`update public.posts set ${sql.id(column)}=${value} where id=${pa.id}`.execute(
                trx,
              ),
            "23514",
          );
        for (const content of ["", "x".repeat(16385)])
          await mustFail(
            () => trx.updateTable("comments").set({ content }).where("id", "=", ca.id).execute(),
            "23514",
          );
        await mustFail(
          () =>
            sql`insert into public.reactions(owner_id,post_id,kind) values (${a},${pb.id},'admin')`.execute(
              trx,
            ),
          "23514",
        );
        for (const table of tables) {
          const row = await trx
            .selectFrom(table)
            .selectAll()
            .where("owner_id", "=", a)
            .executeTakeFirstOrThrow();
          for (const assignment of [
            sql`id=${missing}`,
            sql`owner_id=${b}`,
            sql`created_at=now()+interval '1 day'`,
          ])
            await mustFail(
              () =>
                sql`update ${sql.table(table)} set ${assignment} where id=${row.id}`.execute(trx),
              "23514",
            );
        }
        await mustFail(
          () => sql`update public.comments set post_id=${pb.id} where id=${ca.id}`.execute(trx),
          "23514",
        );
        await mustFail(
          () => sql`update public.reactions set post_id=${pb.id} where id=${ra.id}`.execute(trx),
          "23514",
        );
        await mustFail(
          () => sql`update public.reactions set kind='other' where id=${ra.id}`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.favorites set post_id=null,project_id=${projectA.id} where id=${fa.id}`.execute(
              trx,
            ),
          "23514",
        );
        // Explicit own unlike/unfavorite and reinsert; no broad DELETE on content.
        await asRole("authenticated", a, async () => {
          await trx.deleteFrom("reactions").where("id", "=", ra.id).execute();
          await react(a, pa.id);
          await trx.deleteFrom("favorites").where("id", "=", fa.id).execute();
          await favoritePost(a, pa.id);
        });
        await mustFail(() => trx.deleteFrom("posts").where("id", "=", pa.id).execute(), "23503");
        await mustFail(
          () => trx.deleteFrom("projects").where("id", "=", projectA.id).execute(),
          "23503",
        );
        await mustFail(() => trx.deleteFrom("profiles").where("id", "=", a).execute(), "23503");
        await mustFail(() => sql`delete from auth.users where id=${a}`.execute(trx), "23503");
        for (const domain of ["RED", "FARM", "BUILDER", "COMMAND", "MODS", "SURVIVAL"] as const)
          await trx.updateTable("posts").set({ domain }).where("id", "=", pa.id).execute();
        await trx
          .updateTable("posts")
          .set({ edition: "BEDROCK", game_version: "1.21.0" })
          .where("id", "=", pa.id)
          .execute();
        await sql`select pg_sleep(0.02)`.execute(trx);
        await asRole("authenticated", a, async () => {
          await trx
            .updateTable("posts")
            .set({ content: "Updated" })
            .where("id", "=", pa.id)
            .execute();
          await trx
            .updateTable("comments")
            .set({ content: "Updated" })
            .where("id", "=", ca.id)
            .execute();
        });
        for (const [table, old] of [
          ["posts", pa],
          ["comments", ca],
        ] as const) {
          const row = await trx
            .selectFrom(table)
            .selectAll()
            .where("id", "=", old.id)
            .executeTakeFirstOrThrow();
          assert.equal(row.created_at.getTime(), old.created_at.getTime());
          assert.ok(row.updated_at.getTime() > old.updated_at.getTime());
        }
        await sql`set local timezone to 'America/Sao_Paulo'`.execute(trx);
        assert.equal(
          toUtcTimestamp(
            (
              await trx
                .selectFrom("posts")
                .selectAll()
                .where("id", "=", pa.id)
                .executeTakeFirstOrThrow()
            ).created_at,
          ),
          toUtcTimestamp(pa.created_at),
        );
        await mustFail(() => down<Database>(trx), "P0001");
        // Synthetic cleanup exclusively in a transaction that is always rolled back.
        for (const table of ["favorites", "reactions", "comments"] as const)
          await trx.deleteFrom(table).execute();
        await mustFail(() => down<Database>(trx), "P0001"); // Occupied posts alone must refuse.
        await trx.deleteFrom("posts").execute();
        await sql`create view public.community_unrelated as select id from public.posts`.execute(
          trx,
        );
        await mustFail(() => down<Database>(trx), "2BP01");
        assert.equal(
          (
            await sql<{
              present: boolean;
            }>`select to_regclass('public.posts') is not null as present`.execute(trx)
          ).rows[0]?.present,
          true,
        );
        await sql`drop view public.community_unrelated`.execute(trx);
        await sql`comment on table public.posts is 'Unrelated identity'`.execute(trx);
        await mustFail(() => down<Database>(trx), "P0001");
        await sql`comment on table public.posts is 'MinePRO RED-016 posts v1'`.execute(trx);
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        await up<Database>(trx);
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await trx.selectFrom("projects").selectAll().execute()).length, 2);
        await trx.deleteFrom("projects").execute();
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
      and to_regnamespace('minepro_community_internal') is null and to_regclass('public.posts') is null
      and to_regclass('public.comments') is null and to_regclass('public.reactions') is null
      and to_regclass('public.favorites') is null and to_regclass('public.profiles') is null
      and to_regclass('public.projects') is null and to_regclass('public.conversations') is null
      and to_regprocedure('public.rls_auto_enable()') is null
      and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
      and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clear`.execute(
      db,
    );
    assert.equal(cleaned.rows[0]?.clear, true);
  } finally {
    await db.destroy();
  }
});
