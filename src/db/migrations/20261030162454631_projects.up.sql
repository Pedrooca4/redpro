-- Frozen RED-015 SQL. Run only in the existing Kysely migration transaction.
-- All projects remain private; publishing/moderation/APIs are separate tasks.
DO $migration$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.conversations') IS NULL
    OR to_regclass('public.messages') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'RED-015 requires existing Auth, RED-013 and RED-014';
  END IF;
  IF obj_description('public.profiles'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-013 profiles v1'
    OR obj_description('public.conversations'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-014 conversations v1'
    OR obj_description('public.messages'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-014 messages v1'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a
        ON a.attrelid=c.conrelid AND a.attname='id'
      WHERE c.conrelid='public.profiles'::regclass AND c.contype='p'
        AND c.conkey=ARRAY[a.attnum] AND a.atttypid='uuid'::regtype
    ) OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='auth.uid()'::regprocedure AND prorettype='uuid'::regtype) THEN
    RAISE EXCEPTION 'RED-015 dependency contract differs';
  END IF;
  IF NOT has_schema_privilege('authenticated','public','USAGE')
    OR NOT has_schema_privilege('authenticated','auth','USAGE')
    OR NOT has_function_privilege('authenticated','auth.uid()','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'RED-015 requires existing non-privileged Auth sessions';
  END IF;
END;
$migration$;

CREATE SCHEMA minepro_project_internal;
COMMENT ON SCHEMA minepro_project_internal IS 'MinePRO RED-015 internal v1';
REVOKE ALL ON SCHEMA minepro_project_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (title=btrim(title) AND char_length(title) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (char_length(btrim(description))>0 AND octet_length(description)<=65536),
  domain text NOT NULL CHECK (domain IN ('RED','FARM','BUILDER','COMMAND','MODS','SURVIVAL')),
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_-]{0,63}$'),
  edition text NOT NULL CHECK (edition IN ('JAVA','BEDROCK')),
  version_min text CHECK (version_min IS NULL OR version_min ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  version_max text CHECK (version_max IS NULL OR version_max ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  compatibility_notes text CHECK (compatibility_notes IS NULL OR char_length(compatibility_notes) BETWEEN 1 AND 8192),
  difficulty text CHECK (difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED')),
  prerequisites text CHECK (prerequisites IS NULL OR char_length(prerequisites) BETWEEN 1 AND 8192),
  width integer CHECK (width>0),
  height integer CHECK (height>0),
  length integer CHECK (length>0),
  source_url text CHECK (source_url IS NULL OR (char_length(source_url)<=2048 AND source_url ~ '^https://[^[:space:]@]+$')),
  author_declared_status text NOT NULL DEFAULT 'draft' CHECK (author_declared_status IN ('draft','illustrative','reviewed','tested')),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility='private'),
  validation_status text NOT NULL DEFAULT 'draft' CHECK (validation_status IN ('draft','illustrative','reviewed','tested')),
  validated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  validated_at timestamptz(3),
  validation_evidence text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT projects_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT projects_validation_proof CHECK (
    (validation_status IN ('draft','illustrative') AND validated_by IS NULL AND validated_at IS NULL AND validation_evidence IS NULL)
    OR (validation_status IN ('reviewed','tested') AND validated_by IS NOT NULL AND validated_by<>owner_id
      AND validated_at IS NOT NULL AND validated_at>=created_at AND validation_evidence IS NOT NULL
      AND char_length(btrim(validation_evidence)) BETWEEN 1 AND 8192)
  )
);
COMMENT ON TABLE public.projects IS 'MinePRO RED-015 projects v1';
CREATE INDEX projects_owner_updated_idx ON public.projects(owner_id,updated_at DESC,id);
CREATE INDEX projects_validated_by_idx ON public.projects(validated_by) WHERE validated_by IS NOT NULL;

CREATE TABLE public.project_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence>0),
  title text NOT NULL CHECK (title=btrim(title) AND char_length(title) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK (char_length(btrim(instructions))>0 AND octet_length(instructions)<=65536),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT project_steps_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT project_steps_project_sequence_key UNIQUE (project_id,sequence)
);
COMMENT ON TABLE public.project_steps IS 'MinePRO RED-015 steps v1';

CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  item_key text CHECK (item_key IS NULL OR (char_length(item_key)<=160 AND item_key ~ '^[a-z0-9_.-]+:[a-z0-9_./-]+$')),
  name text NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 160),
  quantity integer NOT NULL CHECK (quantity>0),
  quantity_is_estimate boolean NOT NULL DEFAULT true,
  notes text CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 8192),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT materials_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT materials_project_item_key UNIQUE (project_id,item_key)
);
COMMENT ON TABLE public.materials IS 'MinePRO RED-015 materials v1';

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.projects,public.project_steps,public.materials FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.projects,public.project_steps,public.materials TO authenticated;
GRANT INSERT (owner_id,title,description,domain,category,edition,version_min,version_max,compatibility_notes,difficulty,prerequisites,width,height,length,source_url,author_declared_status)
  ON public.projects TO authenticated;
GRANT UPDATE (title,description,domain,category,edition,version_min,version_max,compatibility_notes,difficulty,prerequisites,width,height,length,source_url,author_declared_status)
  ON public.projects TO authenticated;
GRANT INSERT (project_id,sequence,title,instructions) ON public.project_steps TO authenticated;
GRANT UPDATE (sequence,title,instructions) ON public.project_steps TO authenticated;
GRANT INSERT (project_id,item_key,name,quantity,quantity_is_estimate,notes) ON public.materials TO authenticated;
GRANT UPDATE (item_key,name,quantity,quantity_is_estimate,notes) ON public.materials TO authenticated;
GRANT DELETE ON public.project_steps,public.materials TO authenticated;
-- No public read, publishing, project DELETE, validation write or backend grant.
CREATE POLICY projects_select_own ON public.projects FOR SELECT TO authenticated
  USING (owner_id=(SELECT auth.uid()));
CREATE POLICY projects_insert_own ON public.projects FOR INSERT TO authenticated
  WITH CHECK (owner_id=(SELECT auth.uid()) AND visibility='private' AND validation_status='draft'
    AND validated_by IS NULL AND validated_at IS NULL AND validation_evidence IS NULL);
CREATE POLICY projects_update_own_draft ON public.projects FOR UPDATE TO authenticated
  USING (owner_id=(SELECT auth.uid()) AND validation_status IN ('draft','illustrative'))
  WITH CHECK (owner_id=(SELECT auth.uid()) AND visibility='private' AND validation_status IN ('draft','illustrative'));

CREATE POLICY project_steps_select_own ON public.project_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid())));
CREATE POLICY project_steps_insert_own_draft ON public.project_steps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')));
CREATE POLICY project_steps_update_own_draft ON public.project_steps FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')));
CREATE POLICY project_steps_delete_own_draft ON public.project_steps FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')));
CREATE POLICY materials_select_own ON public.materials FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid())));
CREATE POLICY materials_insert_own_draft ON public.materials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')));
CREATE POLICY materials_update_own_draft ON public.materials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')));
CREATE POLICY materials_delete_own_draft ON public.materials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.validation_status IN ('draft','illustrative')));

CREATE FUNCTION minepro_project_internal.guard_project_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $trigger$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Project identity and ownership are immutable';
  END IF;
  IF OLD.validation_status IN ('reviewed','tested') AND
    ROW(NEW.title,NEW.description,NEW.domain,NEW.category,NEW.edition,NEW.version_min,NEW.version_max,
      NEW.compatibility_notes,NEW.difficulty,NEW.prerequisites,NEW.width,NEW.height,NEW.length,NEW.source_url,NEW.author_declared_status)
    IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.domain,OLD.category,OLD.edition,OLD.version_min,OLD.version_max,
      OLD.compatibility_notes,OLD.difficulty,OLD.prerequisites,OLD.width,OLD.height,OLD.length,OLD.source_url,OLD.author_declared_status) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Validated content requires a separate validation reset before edits';
  END IF;
  IF NEW.validation_status IN ('reviewed','tested') AND
    ROW(NEW.validation_status,NEW.validated_by,NEW.validation_evidence)
    IS DISTINCT FROM ROW(OLD.validation_status,OLD.validated_by,OLD.validation_evidence) THEN
    NEW.validated_at:=statement_timestamp()::timestamptz(3);
  END IF;
  NEW.updated_at:=statement_timestamp()::timestamptz(3);
  RETURN NEW;
END;
$trigger$;

CREATE FUNCTION minepro_project_internal.guard_project_child()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $trigger$
DECLARE
  target uuid;
  state text;
BEGIN
  IF TG_OP='DELETE' THEN target:=OLD.project_id;
  ELSE target:=NEW.project_id;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Project child identity is immutable';
    END IF;
  END IF;
  -- Serialize child writes with validation of the parent. This invoker uses
  -- existing SELECT/UPDATE privileges and RLS, never SECURITY DEFINER.
  SELECT validation_status INTO state FROM public.projects WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Project is not writable';
  END IF;
  IF state NOT IN ('draft','illustrative') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Validated project children are immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;
  ELSIF TG_OP='UPDATE' THEN NEW.updated_at:=statement_timestamp()::timestamptz(3);
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION minepro_project_internal.guard_project_update(),minepro_project_internal.guard_project_child()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER projects_guard_update BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION minepro_project_internal.guard_project_update();
CREATE TRIGGER project_steps_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_steps
  FOR EACH ROW EXECUTE FUNCTION minepro_project_internal.guard_project_child();
CREATE TRIGGER materials_guard BEFORE INSERT OR UPDATE OR DELETE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION minepro_project_internal.guard_project_child();
