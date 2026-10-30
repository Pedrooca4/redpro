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
import { up, down } from "../../src/db/migrations/20261030153608225_conversations_messages.ts";

test("PostgreSQL chat: RED-013 dependency, owner RLS, trusted messages, ordering, timestamps and safe rollback", async () => {
  const config = readDevelopmentDatabaseConfig();
  assert.equal(config.environment, "test");
  assert.equal(config.provider, "local-test");
  const db = createDevelopmentDatabase(config);
  const rollback = new Error("Rollback RED-014 disposable fixture");
  const a = parseAuthUserId("c301fc1a-44f5-4140-b786-4965af4a1dad");
  const b = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
  const missing = newRecordId();
  try {
    await sql`select 1`.execute(db);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        const empty = await sql<{ clear: boolean }>`select
        to_regnamespace('auth') is null and to_regclass('public.profiles') is null
        and to_regclass('public.conversations') is null and to_regclass('public.messages') is null
        and to_regnamespace('minepro_chat_internal') is null
        and to_regnamespace('minepro_profile_internal') is null
        and to_regprocedure('public.rls_auto_enable()') is null
        and not exists(select 1 from pg_event_trigger where evtname='ensure_rls')
        and not exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) as clear`.execute(
          trx,
        );
        assert.equal(empty.rows[0]?.clear, true, "Refuse existing objects or real Auth");
        const mustFail = async (run: () => Promise<unknown>, code: string) => {
          await sql`savepoint rejected_chat_operation`.execute(trx);
          try {
            await assert.rejects(run, { code });
          } finally {
            await sql`rollback to savepoint rejected_chat_operation`.execute(trx);
            await sql`release savepoint rejected_chat_operation`.execute(trx);
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
        await sql`create table auth.users (id uuid primary key)`.execute(trx);
        await sql`create function auth.uid() returns uuid language sql stable security invoker set search_path=pg_catalog
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$`.execute(trx);
        await sql`revoke all on function auth.uid() from public`.execute(trx);
        await sql`grant usage on schema auth to authenticated`.execute(trx);
        await sql`grant execute on function auth.uid() to authenticated`.execute(trx);
        await sql`insert into auth.users(id) values (${a}),(${b})`.execute(trx);
        // Auth alone is not enough: RED-013 must be applied first.
        await mustFail(() => up<Database>(trx), "P0001");
        await profilesUp<Database>(trx);
        await trx
          .insertInto("profiles")
          .values([
            { id: a, display_name: "Synthetic A" },
            { id: b, display_name: "Synthetic B" },
          ])
          .execute();
        const securityFixture = await readFile(
          new URL("../fixtures/rls-auto-enable.sql", import.meta.url),
          "utf8",
        );
        await sql.raw(securityFixture).execute(trx);
        await sql`revoke execute on function public.rls_auto_enable() from public,anon,authenticated`.execute(
          trx,
        );
        await sql`create event trigger ensure_rls on ddl_command_end
          when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
          execute function public.rls_auto_enable()`.execute(trx);
        await sql`alter default privileges in schema public grant all on tables to anon,authenticated,service_role`.execute(
          trx,
        );
        const snapshot = async () =>
          (
            await sql<{ state: unknown }>`select jsonb_build_object(
        'auth',pg_get_functiondef('auth.uid()'::regprocedure),
        'rls_function',pg_get_functiondef('public.rls_auto_enable()'::regprocedure),
        'rls_acl',(select proacl::text from pg_proc where oid='public.rls_auto_enable()'::regprocedure),
        'event',(select to_jsonb(e) from pg_event_trigger e where evtname='ensure_rls'),
        'profile_function',pg_get_functiondef('minepro_profile_internal.stamp_profile_update()'::regprocedure),
        'profile_policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='profiles'),
        'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d)
      ) as state`.execute(trx)
          ).rows[0]?.state;
        const before = await snapshot();
        await up<Database>(trx);
        assert.deepEqual(await snapshot(), before, "Auth, RED-013, S2C and defaults preserved");
        await mustFail(() => up<Database>(trx), "42P06");
        const catalog = await sql<{
          tables: number;
          forced: number;
          policies: number;
          definer: number;
          private_schema: boolean;
        }>`select
        (select count(*)::int from pg_class where oid in ('public.conversations'::regclass,'public.messages'::regclass) and relrowsecurity) as tables,
        (select count(*)::int from pg_class where oid in ('public.conversations'::regclass,'public.messages'::regclass) and relforcerowsecurity) as forced,
        (select count(*)::int from pg_policy where polrelid in ('public.conversations'::regclass,'public.messages'::regclass)) as policies,
        (select count(*)::int from pg_proc where pronamespace='minepro_chat_internal'::regnamespace and prosecdef) as definer,
        not has_schema_privilege('authenticated','minepro_chat_internal','USAGE') as private_schema`.execute(
          trx,
        );
        assert.deepEqual(catalog.rows[0], {
          tables: 2,
          forced: 2,
          policies: 4,
          definer: 0,
          private_schema: true,
        });
        const grants = await sql<{
          anon_read: boolean;
          owner_update: boolean;
          client_write: boolean;
          backend_write: boolean;
          backend_update: boolean;
        }>`select
        has_table_privilege('anon','public.messages','SELECT') as anon_read,
        has_column_privilege('authenticated','public.conversations','owner_id','UPDATE') as owner_update,
        has_any_column_privilege('authenticated','public.messages','INSERT') as client_write,
        has_column_privilege('service_role','public.messages','content','INSERT') as backend_write,
        has_any_column_privilege('service_role','public.messages','UPDATE') as backend_update`.execute(
          trx,
        );
        assert.deepEqual(grants.rows[0], {
          anon_read: false,
          owner_update: false,
          client_write: false,
          backend_write: true,
          backend_update: false,
        });

        const createConversation = (owner: typeof a, title: string) =>
          trx
            .insertInto("conversations")
            .values({ owner_id: owner, title, edition: "JAVA", default_mode: "RED" })
            .returningAll()
            .executeTakeFirstOrThrow();
        let ca!: Awaited<ReturnType<typeof createConversation>>;
        let cb!: Awaited<ReturnType<typeof createConversation>>;
        await asRole("authenticated", a, async () => {
          ca = await createConversation(a, "Conversa A");
          await mustFail(() => createConversation(b, "Stolen B"), "42501");
          await mustFail(
            () =>
              sql`insert into public.conversations(id,owner_id,title,edition,default_mode) values (${newRecordId()},${a},'Forged','JAVA','RED')`.execute(
                trx,
              ),
            "42501",
          );
          await mustFail(
            () => sql`update public.conversations set owner_id=${b} where id=${ca.id}`.execute(trx),
            "42501",
          );
          await mustFail(
            () =>
              sql`update public.conversations set created_at=now() where id=${ca.id}`.execute(trx),
            "42501",
          );
          await mustFail(
            () => trx.deleteFrom("conversations").where("id", "=", ca.id).execute(),
            "42501",
          );
        });
        await asRole("authenticated", b, async () => {
          cb = await createConversation(b, "Conversa B");
          assert.deepEqual(
            (await trx.selectFrom("conversations").selectAll().execute()).map((c) => c.id),
            [cb.id],
          );
          assert.equal(
            (
              await trx
                .updateTable("conversations")
                .set({ title: "Stolen" })
                .where("id", "=", ca.id)
                .executeTakeFirst()
            ).numUpdatedRows,
            BigInt(0),
          );
        });
        assert.equal(parseRecordId(ca.id), ca.id);
        assert.equal(ca.version, null);
        assert.equal(ca.created_at.getTime(), ca.updated_at.getTime());
        const writeMessage = (
          conversation_id: typeof ca.id,
          sequence: number,
          role: "user" | "assistant" | "system" | "tool" = "user",
        ) =>
          trx
            .insertInto("messages")
            .values({
              conversation_id,
              sequence,
              role,
              content: "Synthetic private content",
              selected_mode: "RED",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        // Untrusted clients cannot author ANY role, including forged assistant/system.
        for (const owner of [a, b])
          await asRole("authenticated", owner, async () => {
            for (const role of ["user", "assistant", "system", "tool"] as const)
              for (const conversation of [ca, cb])
                await mustFail(() => writeMessage(conversation.id, 1, role), "42501");
          });
        let first!: Awaited<ReturnType<typeof writeMessage>>;
        await asRole("service_role", null, async () => {
          // Backend picks explicit, immutable sequence. Out-of-order arrival must
          // still be read by sequence, not insertion time/UUID. No max()+1 allocator.
          first = await writeMessage(ca.id, 2, "assistant");
          await writeMessage(ca.id, 1, "user");
          await writeMessage(ca.id, 3, "system");
          await writeMessage(ca.id, 4, "tool");
          await writeMessage(cb.id, 1, "user");
          await mustFail(() => writeMessage(ca.id, 1), "23505");
          await mustFail(() => writeMessage(missing, 1), "23503");
          await mustFail(() => writeMessage(ca.id, 0), "23514");
          await mustFail(() => writeMessage(ca.id, -1), "23514");
          await mustFail(
            () =>
              sql`insert into public.messages(conversation_id,role,sequence,content,selected_mode) values (${ca.id},'user',2147483648,'x','RED')`.execute(
                trx,
              ),
            "22003",
          );
          await mustFail(
            () =>
              sql`insert into public.messages(conversation_id,role,content,selected_mode) values (${ca.id},'user','x','RED')`.execute(
                trx,
              ),
            "23502",
          );
          await mustFail(
            () =>
              sql`insert into public.messages(conversation_id,role,sequence,content,selected_mode) values (${ca.id},'admin',5,'x','RED')`.execute(
                trx,
              ),
            "23514",
          );
          await mustFail(
            () =>
              sql`insert into public.messages(conversation_id,role,sequence,content,selected_mode,created_at) values (${ca.id},'user',5,'x','RED',now())`.execute(
                trx,
              ),
            "42501",
          );
          await mustFail(
            () =>
              trx
                .updateTable("messages")
                .set({ content: "Changed" })
                .where("id", "=", first.id)
                .execute(),
            "42501",
          );
          await mustFail(() => trx.deleteFrom("messages").execute(), "42501");
          for (const content of ["", " ", "x".repeat(262145)])
            await mustFail(
              () =>
                trx
                  .insertInto("messages")
                  .values({
                    conversation_id: ca.id,
                    sequence: 5,
                    role: "user",
                    content,
                    selected_mode: "RED",
                  })
                  .execute(),
              "23514",
            );
        });
        assert.equal(parseRecordId(first.id), first.id);
        assert.deepEqual(first.tool_refs, []);
        assert.equal(first.created_at.getTime(), first.updated_at.getTime());
        await asRole("authenticated", a, async () => {
          assert.deepEqual(
            (await trx.selectFrom("messages").selectAll().orderBy("sequence").execute()).map(
              (m) => m.sequence,
            ),
            [1, 2, 3, 4],
          );
          assert.equal(
            (
              await trx
                .selectFrom("messages")
                .selectAll()
                .where("conversation_id", "=", cb.id)
                .execute()
            ).length,
            0,
          );
          await mustFail(
            () => sql`update public.messages set sequence=9 where id=${first.id}`.execute(trx),
            "42501",
          );
          await mustFail(
            () =>
              sql`update public.messages set conversation_id=${cb.id} where id=${first.id}`.execute(
                trx,
              ),
            "42501",
          );
        });
        await asRole("authenticated", b, async () => {
          assert.equal(
            (await trx.selectFrom("messages").selectAll().where("id", "=", first.id).execute())
              .length,
            0,
          );
          assert.equal((await trx.selectFrom("messages").selectAll().execute()).length, 1);
        });
        await asRole("authenticated", null, async () => {
          assert.equal((await trx.selectFrom("messages").selectAll().execute()).length, 0);
          assert.equal((await trx.selectFrom("conversations").selectAll().execute()).length, 0);
          await mustFail(() => createConversation(a, "No session"), "42501");
        });
        await asRole("anon", null, async () => {
          await mustFail(() => trx.selectFrom("conversations").selectAll().execute(), "42501");
          await mustFail(() => trx.selectFrom("messages").selectAll().execute(), "42501");
          await mustFail(() => createConversation(a, "Anonymous"), "42501");
          await mustFail(() => writeMessage(ca.id, 6), "42501");
        });
        // Database-level constraints remain in force for privileged writers too.
        await mustFail(
          () => createConversation(parseAuthUserId(missing), "Missing owner"),
          "23503",
        );
        for (const [column, value] of [
          ["title", ""],
          ["title", "x".repeat(161)],
          ["title", " Leading"],
          ["edition", "POCKET"],
          ["default_mode", "ADMIN"],
          ["version", " "],
        ] as const)
          await mustFail(
            () =>
              sql`update public.conversations set ${sql.id(column)}=${value} where id=${ca.id}`.execute(
                trx,
              ),
            "23514",
          );
        await mustFail(
          () => sql`update public.conversations set id=${missing} where id=${ca.id}`.execute(trx),
          "23514",
        );
        await mustFail(
          () => sql`update public.conversations set owner_id=${b} where id=${ca.id}`.execute(trx),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.conversations set created_at=now()+interval '1 day' where id=${ca.id}`.execute(
              trx,
            ),
          "23514",
        );
        for (const assignment of [
          sql`id=${missing}`,
          sql`conversation_id=${cb.id}`,
          sql`role='system'`,
          sql`sequence=10`,
          sql`created_at=now()+interval '1 day'`,
        ])
          await mustFail(
            () => sql`update public.messages set ${assignment} where id=${first.id}`.execute(trx),
            "23514",
          );
        await mustFail(
          () =>
            sql`insert into public.conversations(id,owner_id,title,edition,default_mode) values (${b},${a},'Non-v4','JAVA','RED')`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`insert into public.messages(id,conversation_id,role,sequence,content,selected_mode) values (${b},${ca.id},'user',6,'x','RED')`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.messages set selected_mode='INVALID' where id=${first.id}`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.messages set tool_refs=array[null]::uuid[] where id=${first.id}`.execute(
              trx,
            ),
          "23514",
        );
        await mustFail(
          () =>
            sql`update public.messages set tool_refs=array_fill(gen_random_uuid(),array[33]) where id=${first.id}`.execute(
              trx,
            ),
          "23514",
        );
        await sql`update public.messages set tool_refs=array[${newRecordId()}]::uuid[] where id=${first.id}`.execute(
          trx,
        );
        await mustFail(
          () => trx.deleteFrom("conversations").where("id", "=", ca.id).execute(),
          "23503",
        );
        await mustFail(() => trx.deleteFrom("profiles").where("id", "=", a).execute(), "23503");
        await mustFail(() => profilesDown<Database>(trx), "P0001");
        await sql`select pg_sleep(0.02)`.execute(trx);
        await asRole("authenticated", a, async () => {
          await trx
            .updateTable("conversations")
            .set({
              title: "Updated A",
              edition: "BEDROCK",
              version: "1.21.0",
              default_mode: "FARM",
            })
            .where("id", "=", ca.id)
            .execute();
        });
        const changed = await trx
          .selectFrom("conversations")
          .selectAll()
          .where("id", "=", ca.id)
          .executeTakeFirstOrThrow();
        assert.equal(changed.created_at.getTime(), ca.created_at.getTime());
        assert.ok(changed.updated_at.getTime() > ca.updated_at.getTime());
        await sql`update public.messages set content='Synthetic corrected content' where id=${first.id}`.execute(
          trx,
        );
        const changedMessage = await trx
          .selectFrom("messages")
          .selectAll()
          .where("id", "=", first.id)
          .executeTakeFirstOrThrow();
        assert.equal(changedMessage.created_at.getTime(), first.created_at.getTime());
        assert.ok(changedMessage.updated_at.getTime() > first.updated_at.getTime());
        await sql`set local timezone to 'America/Sao_Paulo'`.execute(trx);
        assert.equal(
          toUtcTimestamp(
            (
              await trx
                .selectFrom("messages")
                .selectAll()
                .where("id", "=", first.id)
                .executeTakeFirstOrThrow()
            ).created_at,
          ),
          toUtcTimestamp(first.created_at),
        );
        // Refuse occupied rollback and preserve both tables via savepoint rollback.
        await mustFail(() => down<Database>(trx), "P0001");
        assert.equal((await trx.selectFrom("messages").selectAll().execute()).length, 5);
        await trx.deleteFrom("messages").execute(); // Synthetic fixture ONLY.
        await mustFail(() => down<Database>(trx), "P0001"); // Empty messages, occupied conversations.
        await trx.deleteFrom("conversations").execute();
        await sql`create table minepro_chat_internal.unrelated_guard (value text)`.execute(trx);
        await mustFail(() => down<Database>(trx), "2BP01");
        assert.equal(
          (
            await sql<{
              present: boolean;
            }>`select to_regclass('public.messages') is not null as present`.execute(trx)
          ).rows[0]?.present,
          true,
        );
        await sql`drop table minepro_chat_internal.unrelated_guard`.execute(trx);
        await down<Database>(trx);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await trx.selectFrom("profiles").selectAll().execute()).length, 2);
        await up<Database>(trx);
        await down<Database>(trx);
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
      and to_regclass('public.conversations') is null and to_regclass('public.messages') is null
      and to_regnamespace('minepro_chat_internal') is null and to_regnamespace('minepro_profile_internal') is null
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
