-- Frozen RED-013 SQL. Kysely executes the whole migration transactionally.
-- Requires existing Supabase Auth objects; never creates or modifies them.
DO $migration$
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'RED-013 requires existing Supabase Auth objects';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'id'
    WHERE c.conrelid = 'auth.users'::regclass AND c.contype = 'p'
      AND c.conkey = ARRAY[a.attnum] AND a.atttypid = 'uuid'::regtype
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc WHERE oid = 'auth.uid()'::regprocedure
      AND prorettype = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION 'RED-013 requires Auth UUID primary key and uid contract';
  END IF;
  IF NOT has_schema_privilege('authenticated', 'public', 'USAGE')
    OR NOT has_schema_privilege('authenticated', 'auth', 'USAGE')
    OR NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'RED-013 requires existing Auth session permissions';
  END IF;
END;
$migration$;

-- No IF NOT EXISTS: refuse collisions instead of adopting existing objects.
CREATE SCHEMA minepro_profile_internal;
COMMENT ON SCHEMA minepro_profile_internal IS 'MinePRO RED-013 internal v1';
REVOKE ALL ON SCHEMA minepro_profile_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT profiles_auth_user_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT profiles_display_name_check CHECK (
    display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80
  ),
  CONSTRAINT profiles_preferences_object_check CHECK (jsonb_typeof(preferences) = 'object')
);
COMMENT ON TABLE public.profiles IS 'MinePRO RED-013 profiles v1';

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
-- Supabase default privileges may otherwise give broad grants on new tables.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT INSERT (id, display_name, preferences) ON public.profiles TO authenticated;
GRANT UPDATE (display_name, preferences) ON public.profiles TO authenticated;

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
-- No DELETE policy/grant. Account deletion requires an explicit retention flow.

-- Trigger code has no elevated rights. It only checks/assigns the NEW row.
CREATE FUNCTION minepro_profile_internal.stamp_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $trigger$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Profile identity and creation time are immutable';
  END IF;
  NEW.updated_at := statement_timestamp()::timestamptz(3);
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION minepro_profile_internal.stamp_profile_update()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER profiles_stamp_update BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION minepro_profile_internal.stamp_profile_update();
