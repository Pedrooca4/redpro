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
import { up, down } from "../../src/db/migrations/20261030162454631_projects.ts";

test("PostgreSQL projects: private authorship, child isolation, honest validation, constraints, timestamps and safe rollback", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  const rollback = new Error("Rollback RED-015 disposable fixture");
  const a = parseAuthUserId("c301fc1a-44f5-4140-b786-4965af4a1dad");
  const b = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
  const missing = newRecordId();
  try {
    await sql`select 1`.execute(db);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        const absent = await sql<{ clear: boolean }>`select to_regnamespace('auth') is null
        and to_regclass('public.profiles') is null and to_regclass('public.conversations') is null
        and to_regclass('public.messages') is null and to_regclass('public.projects') is null
        and to_regclass('public.project_steps') is null and to_regclass('public.materials') is null
        and to_regnamespace('minepro_project_internal') is null
        and to_regnamespace('minepro_profile_internal') is null and to_regnamespace('minepro_chat_internal') is null
        and to_regprocedure('public.rls_auto_enable()') is null
        and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
        and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clear`.execute(
          trx,
        );
        assert.equal(absent.rows[0]?.clear, true, "Refuse existing fixture or real Auth");
        const mustFail = async (run: () => Promise<unknown>, code: string) => {
          await sql`savepoint rejected_project_operation`.execute(trx);
          try {
            await assert.rejects(run, { code });
          } finally {
            await sql`rollback to savepoint rejected_project_operation`.execute(trx);
            await sql`release savepoint rejected_project_operation`.execute(trx);
          }
        };
        const asRole = async (
          role: "authenticated" | "anon" | "service_role",
          id: string | null,
          run: () => Promise<void>,
        ) => {
          await sql`set local role ${sql.id(role)}`.execute(trx);
          await sql`select set_config('request.jwt.claim.sub',${id ?? ""},true)`.execute(trx);
          try {
            await run();
          } finally {
            await sql`reset role`.execute(trx);
          }
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
        await mustFail(() => up<Database>(trx), "P0001"); // RED-014 must precede RED-015.
        await chatUp<Database>(trx);
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
        'auth',pg_get_functiondef('auth.uid()'::regprocedure),
        'rls',pg_get_functiondef('public.rls_auto_enable()'::regprocedure),
        'acl',(select proacl::text from pg_proc where oid='public.rls_auto_enable()'::regprocedure),
        'event',(select to_jsonb(e) from pg_event_trigger e where evtname='ensure_rls'),
        'profiles_helper',pg_get_functiondef('minepro_profile_internal.stamp_profile_update()'::regprocedure),
        'chat_helper',pg_get_functiondef('minepro_chat_internal.stamp_conversation_update()'::regprocedure),
        'message_helper',pg_get_functiondef('minepro_chat_internal.stamp_message_update()'::regprocedure),
        'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public' and tablename in ('profiles','conversations','messages')),
        'grants',(select jsonb_agg(to_jsonb(g) order by table_name,grantee,privilege_type) from information_schema.role_table_grants g where table_schema='public' and table_name in ('profiles','conversations','messages')),
        'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d)
      ) as state`.execute(trx)
          ).rows[0]?.state;
        const before = await snapshot();
        await up<Database>(trx);
        assert.deepEqual(await snapshot(), before, "Auth, RED-013/014, S2C and defaults preserved");
        const catalog = await sql<{
          enabled: number;
          forced: number;
          policies: number;
          fk: number;
          definers: number;
          protected: boolean;
        }>`select
        (select count(*)::int from pg_class where oid in ('public.projects'::regclass,'public.project_steps'::regclass,'public.materials'::regclass) and relrowsecurity) as enabled,
        (select count(*)::int from pg_class where oid in ('public.projects'::regclass,'public.project_steps'::regclass,'public.materials'::regclass) and relforcerowsecurity) as forced,
        (select count(*)::int from pg_policy where polrelid in ('public.projects'::regclass,'public.project_steps'::regclass,'public.materials'::regclass)) as policies,
        (select count(*)::int from pg_constraint where contype='f' and conrelid in ('public.projects'::regclass,'public.project_steps'::regclass,'public.materials'::regclass)) as fk,
        (select count(*)::int from pg_proc where pronamespace='minepro_project_internal'::regnamespace and prosecdef) as definers,
        not has_schema_privilege('authenticated','minepro_project_internal','USAGE') as protected`.execute(
          trx,
        );
        assert.deepEqual(catalog.rows[0], {
          enabled: 3,
          forced: 3,
          policies: 11,
          fk: 4,
          definers: 0,
          protected: true,
        });
        for (const role of ["anon", "service_role"])
          for (const table of ["projects", "project_steps", "materials"])
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
        for (const column of [
          "id",
          "owner_id",
          "visibility",
          "validation_status",
          "validated_by",
          "validated_at",
          "validation_evidence",
          "created_at",
          "updated_at",
        ])
          assert.equal(
            (
              await sql<{
                allowed: boolean;
              }>`select has_column_privilege('authenticated','public.projects',${column},'UPDATE') as allowed`.execute(
                trx,
              )
            ).rows[0]?.allowed,
            false,
          );
        await mustFail(() => up<Database>(trx), "42P06");
        await down<Database>(trx); // Empty schema reverses without touching prerequisites.
        assert.deepEqual(await snapshot(), before);
        await up<Database>(trx);

        const projectBase = {
          description: "Synthetic private project",
          domain: "BUILDER" as const,
          category: "base",
          edition: "JAVA" as const,
        };
        const createProject = (owner: typeof a, title: string) =>
          trx
            .insertInto("projects")
            .values({ ...projectBase, owner_id: owner, title, author_declared_status: "tested" })
            .returningAll()
            .executeTakeFirstOrThrow();
        let pa!: Awaited<ReturnType<typeof createProject>>;
        let pb!: Awaited<ReturnType<typeof createProject>>;
        await asRole("authenticated", a, async () => {
          pa = await createProject(a, "Project A");
          assert.equal(pa.validation_status, "draft");
          assert.equal(pa.author_declared_status, "tested");
          assert.equal(pa.visibility, "private");
          assert.equal(pa.validated_by, null);
          assert.equal(pa.validated_at, null);
          await mustFail(() => createProject(b, "Stolen"), "42501");
          for (const assignment of [
            sql`owner_id=${b}`,
            sql`validation_status='tested'`,
            sql`validated_by=${a}`,
            sql`validation_evidence='I say so'`,
            sql`visibility='public'`,
            sql`updated_at=now()`,
          ])
            await mustFail(
              () => sql`update public.projects set ${assignment} where id=${pa.id}`.execute(trx),
              "42501",
            );
          await mustFail(
            () =>
              sql`insert into public.projects(owner_id,title,description,domain,category,edition,validation_status) values (${a},'Fake','x','RED','farm','JAVA','tested')`.execute(
                trx,
              ),
            "42501",
          );
          await mustFail(
            () => trx.deleteFrom("projects").where("id", "=", pa.id).execute(),
            "42501",
          );
        });
        await asRole("authenticated", b, async () => {
          pb = await createProject(b, "Project B");
          assert.deepEqual(
            (await trx.selectFrom("projects").selectAll().execute()).map((p) => p.id),
            [pb.id],
          );
          assert.equal(
            (
              await trx
                .updateTable("projects")
                .set({ title: "Stolen" })
                .where("id", "=", pa.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
        });
        assert.equal(parseRecordId(pa.id), pa.id);
        assert.equal(pa.difficulty, null);
        assert.equal(pa.version_min, null);
        assert.equal(pa.created_at.getTime(), pa.updated_at.getTime());
        const createStep = (project_id: typeof pa.id, sequence: number) =>
          trx
            .insertInto("project_steps")
            .values({ project_id, sequence, title: "Step", instructions: "Synthetic step" })
            .returningAll()
            .executeTakeFirstOrThrow();
        const createMaterial = (project_id: typeof pa.id, quantity: number) =>
          trx
            .insertInto("materials")
            .values({ project_id, item_key: "minecraft:stone", name: "Stone", quantity })
            .returningAll()
            .executeTakeFirstOrThrow();
        let step!: Awaited<ReturnType<typeof createStep>>;
        let material!: Awaited<ReturnType<typeof createMaterial>>;
        await asRole("authenticated", a, async () => {
          step = await createStep(pa.id, 2);
          await createStep(pa.id, 1);
          material = await createMaterial(pa.id, 64);
          assert.equal(material.quantity_is_estimate, true);
          await mustFail(() => createStep(pa.id, 1), "23505");
          await mustFail(() => createMaterial(pa.id, 1), "23505");
          await mustFail(() => createStep(pa.id, 0), "23514");
          await mustFail(() => createStep(pb.id, 1), "42501");
          await mustFail(() => createMaterial(pb.id, 1), "42501");
          await mustFail(
            () =>
              sql`update public.project_steps set project_id=${pb.id} where id=${step.id}`.execute(
                trx,
              ),
            "42501",
          );
          await mustFail(
            () =>
              sql`update public.materials set project_id=${pb.id} where id=${material.id}`.execute(
                trx,
              ),
            "42501",
          );
          for (const quantity of [0, -1])
            await mustFail(
              () =>
                trx
                  .updateTable("materials")
                  .set({ quantity })
                  .where("id", "=", material.id)
                  .execute(),
              "23514",
            );
          assert.deepEqual(
            (await trx.selectFrom("project_steps").selectAll().orderBy("sequence").execute()).map(
              (s) => s.sequence,
            ),
            [1, 2],
          );
        });
        await asRole("authenticated", b, async () => {
          assert.equal((await trx.selectFrom("project_steps").selectAll().execute()).length, 0);
          assert.equal((await trx.selectFrom("materials").selectAll().execute()).length, 0);
          await createStep(pb.id, 1); // Sequence uniqueness is per project.
          await createMaterial(pb.id, 1); // Material key uniqueness is per project.
          assert.equal(
            (
              await trx
                .updateTable("project_steps")
                .set({ instructions: "Stolen" })
                .where("id", "=", step.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
          assert.equal(
            (
              await trx
                .updateTable("materials")
                .set({ quantity: 2 })
                .where("id", "=", material.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
          assert.equal(
            (await trx.deleteFrom("project_steps").where("id", "=", step.id).executeTakeFirst())
              .numDeletedRows,
            BigInt(0),
          );
        });
        await asRole("authenticated", null, async () => {
          for (const table of ["projects", "project_steps", "materials"] as const)
            assert.equal((await trx.selectFrom(table).selectAll().execute()).length, 0);
          await mustFail(() => createProject(a, "No session"), "42501");
          await mustFail(() => createStep(pa.id, 3), "42501");
        });
        for (const role of ["anon", "service_role"] as const)
          await asRole(role, null, async () => {
            for (const table of ["projects", "project_steps", "materials"] as const)
              await mustFail(() => trx.selectFrom(table).selectAll().execute(), "42501");
            await mustFail(() => createProject(a, "Not authorized"), "42501");
          });
        await mustFail(() => createProject(parseAuthUserId(missing), "Orphan"), "23503");
        await mustFail(() => createStep(missing, 1), "42501"); // Trigger deliberately hides missing vs inaccessible parent.
        assert.equal(parseRecordId(step.id), step.id);
        assert.equal(parseRecordId(material.id), material.id);
        await mustFail(
          () =>
            sql`insert into public.projects(id,owner_id,title,description,domain,category,edition)
            values (${b},${a},'Non-v4','Synthetic','RED','farm','JAVA')`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`insert into public.project_steps(id,project_id,sequence,title,instructions)
            values (${b},${pa.id},3,'Non-v4','Synthetic')`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`insert into public.materials(id,project_id,item_key,name,quantity)
            values (${b},${pa.id},'minecraft:dirt','Non-v4',1)`.execute(trx),
          "23514",
        );
        await mustFail(
          () => sql`update public.projects set visibility='public' where id=${pa.id}`.execute(trx),
          "23514",
        );
        for (const [column, value] of [
          ["title", ""],
          ["title", "x".repeat(161)],
          ["title", " Leading"],
          ["description", ""],
          ["description", "x".repeat(65537)],
          ["domain", "ADMIN"],
          ["category", "Not a slug"],
          ["edition", "POCKET"],
          ["difficulty", "EXPERT"],
          ["version_min", " "],
          ["source_url", "http://example.invalid"],
          ["source_url", "https://user:pass@example.invalid"],
        ] as const)
          await mustFail(
            () =>
              sql`update public.projects set ${sql.id(column)}=${value} where id=${pa.id}`.execute(
                trx,
              ),
            "23514",
          );
        await mustFail(
          () => sql`update public.projects set width=0 where id=${pa.id}`.execute(trx),
          "23514",
        );
        for (const domain of ["RED", "FARM", "BUILDER", "COMMAND", "MODS", "SURVIVAL"] as const)
          await trx.updateTable("projects").set({ domain }).where("id", "=", pa.id).execute();
        await trx
          .updateTable("projects")
          .set({
            version_min: "1.20.1",
            version_max: "1.21-pre1",
            compatibility_notes: "Declared, not verified",
            width: 21,
            height: 8,
            length: 21,
            source_url: "https://example.invalid/project",
          })
          .where("id", "=", pa.id)
          .execute();
        for (const assignment of [
          sql`id=${missing}`,
          sql`owner_id=${b}`,
          sql`created_at=now()+interval '1 day'`,
        ])
          await mustFail(
            () => sql`update public.projects set ${assignment} where id=${pa.id}`.execute(trx),
            "23514",
          );
        await mustFail(
          () =>
            sql`update public.project_steps set project_id=${pb.id} where id=${step.id}`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () => sql`update public.materials set id=${missing} where id=${material.id}`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.materials set created_at=now()+interval '1 day' where id=${material.id}`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.materials set item_key='not namespaced' where id=${material.id}`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () => sql`delete from public.projects where id=${pa.id}`.execute(trx),
          "23503",
        );
        await mustFail(() => trx.deleteFrom("profiles").where("id", "=", a).execute(), "23503");
        await sql`select pg_sleep(0.02)`.execute(trx);
        await asRole("authenticated", a, async () => {
          await trx
            .updateTable("projects")
            .set({ title: "Updated A" })
            .where("id", "=", pa.id)
            .execute();
          await trx
            .updateTable("project_steps")
            .set({ instructions: "Updated step" })
            .where("id", "=", step.id)
            .execute();
          await trx
            .updateTable("materials")
            .set({ quantity: 65 })
            .where("id", "=", material.id)
            .execute();
        });
        const changed = await trx
          .selectFrom("projects")
          .selectAll()
          .where("id", "=", pa.id)
          .executeTakeFirstOrThrow();
        const changedStep = await trx
          .selectFrom("project_steps")
          .selectAll()
          .where("id", "=", step.id)
          .executeTakeFirstOrThrow();
        const changedMaterial = await trx
          .selectFrom("materials")
          .selectAll()
          .where("id", "=", material.id)
          .executeTakeFirstOrThrow();
        for (const [oldRow, newRow] of [
          [pa, changed],
          [step, changedStep],
          [material, changedMaterial],
        ]) {
          assert.equal(oldRow.created_at.getTime(), newRow.created_at.getTime());
          assert.ok(newRow.updated_at.getTime() > oldRow.updated_at.getTime());
        }
        await sql`set local timezone to 'America/Sao_Paulo'`.execute(trx);
        assert.equal(
          toUtcTimestamp(
            (
              await trx
                .selectFrom("projects")
                .selectAll()
                .where("id", "=", pa.id)
                .executeTakeFirstOrThrow()
            ).created_at,
          ),
          toUtcTimestamp(pa.created_at),
        );
        // A privileged synthetic writer still cannot create evidence-free/self-reviewed badges.
        await mustFail(
          () =>
            sql`update public.projects set validation_status='tested' where id=${pa.id}`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.projects set validation_status='tested',validated_by=${a},validation_evidence='Self claim' where id=${pa.id}`.execute(
              trx,
            ),
          "23514",
        );
        await sql`update public.projects set validation_status='tested',validated_by=${b},validation_evidence='Synthetic fixture proof only' where id=${pa.id}`.execute(
          trx,
        );
        const validated = await trx
          .selectFrom("projects")
          .selectAll()
          .where("id", "=", pa.id)
          .executeTakeFirstOrThrow();
        assert.equal(validated.validation_status, "tested");
        assert.equal(validated.validated_by, b);
        assert.ok(validated.validated_at instanceof Date);
        await asRole("authenticated", a, async () => {
          assert.equal(
            (
              await trx
                .updateTable("projects")
                .set({ title: "Stale validation" })
                .where("id", "=", pa.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
          assert.equal(
            (
              await trx
                .updateTable("project_steps")
                .set({ instructions: "Stale step" })
                .where("id", "=", step.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
          assert.equal(
            (await trx.deleteFrom("materials").where("id", "=", material.id).executeTakeFirst())
              .numDeletedRows,
            BigInt(0),
          );
          await mustFail(() => createStep(pa.id, 3), "42501");
          await mustFail(() => createMaterial(pa.id, 1), "42501");
          await mustFail(
            () =>
              sql`update public.projects set validation_status='draft' where id=${pa.id}`.execute(
                trx,
              ),
            "42501",
          );
        });
        // A reviewer ID is not a moderation grant; user B still cannot write A.
        await asRole("authenticated", b, async () => {
          assert.equal(
            (
              await trx
                .updateTable("projects")
                .set({ title: "Reviewer is not admin" })
                .where("id", "=", pa.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
        });
        await mustFail(
          () =>
            trx
              .updateTable("projects")
              .set({ description: "Stale proof" })
              .where("id", "=", pa.id)
              .execute(),
          "23514",
        );
        await mustFail(
          () =>
            trx
              .updateTable("project_steps")
              .set({ instructions: "Stale proof" })
              .where("id", "=", step.id)
              .execute(),
          "23514",
        );
        await mustFail(
          () => trx.deleteFrom("materials").where("id", "=", material.id).execute(),
          "23514",
        );
        await mustFail(() => down<Database>(trx), "P0001");
        // Explicit synthetic reset only; no reset API/role/function is implemented.
        await sql`update public.projects set validation_status='draft',validated_by=null,validated_at=null,validation_evidence=null where id=${pa.id}`.execute(
          trx,
        );
        await asRole("authenticated", a, async () => {
          await trx
            .updateTable("materials")
            .set({ quantity: 66 })
            .where("id", "=", material.id)
            .execute();
          await trx.deleteFrom("project_steps").where("id", "=", step.id).execute();
        });
        // Synthetic fixture cleanup, never a recipe for deleting real project data.
        await trx.deleteFrom("project_steps").execute();
        await trx.deleteFrom("materials").execute();
        await mustFail(() => down<Database>(trx), "P0001"); // Occupied parent also blocks rollback.
        await trx.deleteFrom("projects").execute();
        await sql`create table minepro_project_internal.unrelated_guard(value text)`.execute(trx);
        await mustFail(() => down<Database>(trx), "2BP01");
        assert.equal(
          (
            await sql<{
              present: boolean;
            }>`select to_regclass('public.projects') is not null as present`.execute(trx)
          ).rows[0]?.present,
          true,
        );
        await sql`drop table minepro_project_internal.unrelated_guard`.execute(trx);
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await trx.selectFrom("profiles").selectAll().execute()).length, 2);
        await up<Database>(trx);
        await down<Database>(trx);
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
      and to_regnamespace('minepro_project_internal') is null and to_regnamespace('minepro_profile_internal') is null
      and to_regnamespace('minepro_chat_internal') is null and to_regclass('public.projects') is null
      and to_regclass('public.project_steps') is null and to_regclass('public.materials') is null
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
