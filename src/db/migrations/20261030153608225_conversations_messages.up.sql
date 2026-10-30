-- Frozen RED-014 SQL. Execute in the existing Kysely migration transaction.
-- Requires RED-013; never creates or modifies Auth, profiles or security objects.
DO $migration$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'RED-014 requires RED-013 and existing Supabase Auth';
  END IF;
  IF obj_description('public.profiles'::regclass, 'pg_class') IS DISTINCT FROM 'MinePRO RED-013 profiles v1'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'id'
      WHERE c.conrelid = 'public.profiles'::regclass AND c.contype = 'p'
        AND c.conkey = ARRAY[a.attnum] AND a.atttypid = 'uuid'::regtype
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE oid = 'auth.uid()'::regprocedure AND prorettype = 'uuid'::regtype
    ) THEN
    RAISE EXCEPTION 'RED-014 dependency contract differs';
  END IF;
  IF NOT has_schema_privilege('authenticated', 'public', 'USAGE')
    OR NOT has_schema_privilege('authenticated', 'auth', 'USAGE')
    OR NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated' AND NOT rolsuper AND NOT rolbypassrls)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'RED-014 requires existing session and backend role contracts';
  END IF;
END;
$migration$;

CREATE SCHEMA minepro_chat_internal;
COMMENT ON SCHEMA minepro_chat_internal IS 'MinePRO RED-014 internal v1';
REVOKE ALL ON SCHEMA minepro_chat_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL,
  edition text NOT NULL CHECK (edition IN ('JAVA','BEDROCK')),
  version text,
  default_mode text NOT NULL CHECK (default_mode IN ('RED','FARM','BUILDER','COMMAND','MODS','SURVIVAL')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT conversations_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT conversations_title_check CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT conversations_version_check CHECK (version IS NULL OR version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$')
);
COMMENT ON TABLE public.conversations IS 'MinePRO RED-014 conversations v1';
CREATE INDEX conversations_owner_updated_idx ON public.conversations(owner_id, updated_at DESC, id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  sequence integer NOT NULL CHECK (sequence > 0),
  content text NOT NULL CHECK (char_length(btrim(content)) > 0 AND octet_length(content) <= 262144),
  selected_mode text NOT NULL CHECK (selected_mode IN ('RED','FARM','BUILDER','COMMAND','MODS','SURVIVAL')),
  tool_refs uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT messages_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT messages_conversation_sequence_key UNIQUE (conversation_id, sequence),
  CONSTRAINT messages_tool_refs_dimension CHECK (coalesce(array_ndims(tool_refs), 1) = 1),
  CONSTRAINT messages_tool_refs_limit CHECK (cardinality(tool_refs) <= 32),
  CONSTRAINT messages_tool_refs_not_null CHECK (array_position(tool_refs, NULL) IS NULL)
);
COMMENT ON TABLE public.messages IS 'MinePRO RED-014 messages v1';

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
-- Remove inherited defaults on these new tables only; do not alter defaults.
REVOKE ALL ON TABLE public.conversations, public.messages FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.conversations, public.messages TO authenticated;
GRANT INSERT (owner_id, title, edition, version, default_mode) ON public.conversations TO authenticated;
GRANT UPDATE (title, edition, version, default_mode) ON public.conversations TO authenticated;

CREATE POLICY conversations_select_own ON public.conversations FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY conversations_insert_own ON public.conversations FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY conversations_update_own ON public.conversations FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id) WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY messages_select_own ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.owner_id = (SELECT auth.uid())));

-- Messages are backend-authored, including user messages after session checks.
-- service_role is private/BYPASSRLS, never a player session. Future endpoints
-- must verify ownership and choose role/sequence; no endpoint is added here.
GRANT SELECT ON TABLE public.conversations, public.messages TO service_role;
GRANT INSERT (conversation_id, role, sequence, content, selected_mode, tool_refs)
  ON public.messages TO service_role;
-- No API UPDATE/DELETE/TRUNCATE on messages; no client INSERT or role control.

CREATE FUNCTION minepro_chat_internal.stamp_conversation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $trigger$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Conversation identity and ownership are immutable';
  END IF;
  NEW.updated_at := statement_timestamp()::timestamptz(3);
  RETURN NEW;
END;
$trigger$;
CREATE FUNCTION minepro_chat_internal.stamp_message_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $trigger$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.role IS DISTINCT FROM OLD.role OR NEW.sequence IS DISTINCT FROM OLD.sequence
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Message identity, role and order are immutable';
  END IF;
  NEW.updated_at := statement_timestamp()::timestamptz(3);
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION minepro_chat_internal.stamp_conversation_update(), minepro_chat_internal.stamp_message_update()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER conversations_stamp_update BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION minepro_chat_internal.stamp_conversation_update();
CREATE TRIGGER messages_stamp_update BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION minepro_chat_internal.stamp_message_update();
