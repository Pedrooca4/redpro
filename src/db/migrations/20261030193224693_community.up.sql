-- Frozen RED-016. Existing Kysely transaction only; no publication or APIs.
DO $migration$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.projects') IS NULL
    OR to_regclass('public.conversations') IS NULL OR to_regclass('public.messages') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'RED-016 requires Auth and preceding RED-013/014/015';
  END IF;
  IF obj_description('public.profiles'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-013 profiles v1'
    OR obj_description('public.projects'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-015 projects v1'
    OR obj_description('public.conversations'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-014 conversations v1'
    OR obj_description('public.messages'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-014 messages v1'
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='auth.uid()'::regprocedure AND prorettype='uuid'::regtype)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
      WHERE c.conrelid='public.profiles'::regclass AND c.contype='p' AND c.conkey=ARRAY[a.attnum] AND a.atttypid='uuid'::regtype) THEN
    RAISE EXCEPTION 'RED-016 dependency contract differs';
  END IF;
  IF NOT has_schema_privilege('authenticated','public','USAGE')
    OR NOT has_schema_privilege('authenticated','auth','USAGE')
    OR NOT has_function_privilege('authenticated','auth.uid()','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'RED-016 requires existing non-privileged Auth sessions';
  END IF;
END;
$migration$;
CREATE SCHEMA minepro_community_internal;
COMMENT ON SCHEMA minepro_community_internal IS 'MinePRO RED-016 internal v1';
REVOKE ALL ON SCHEMA minepro_community_internal FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (title=btrim(title) AND char_length(title) BETWEEN 1 AND 160),
  content text NOT NULL CHECK (char_length(btrim(content))>0 AND octet_length(content)<=65536),
  domain text NOT NULL CHECK (domain IN ('RED','FARM','BUILDER','COMMAND','MODS','SURVIVAL')),
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_-]{0,63}$'),
  edition text NOT NULL CHECK (edition IN ('JAVA','BEDROCK')),
  game_version text CHECK (game_version IS NULL OR game_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility='private'),
  publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status='draft'),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT posts_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
COMMENT ON TABLE public.posts IS 'MinePRO RED-016 posts v1';
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE RESTRICT,
  content text NOT NULL CHECK (char_length(btrim(content))>0 AND octet_length(content)<=16384),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT comments_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
COMMENT ON TABLE public.comments IS 'MinePRO RED-016 comments v1';
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

CREATE TABLE public.reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'like' CHECK (kind='like'),
  CONSTRAINT reactions_owner_post_key UNIQUE (owner_id,post_id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT reactions_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
COMMENT ON TABLE public.reactions IS 'MinePRO RED-016 reactions v1';
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions FORCE ROW LEVEL SECURITY;

CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  post_id uuid REFERENCES public.posts(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
  CONSTRAINT favorites_one_target CHECK (num_nonnulls(post_id,project_id)=1),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT favorites_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
COMMENT ON TABLE public.favorites IS 'MinePRO RED-016 favorites v1';
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites FORCE ROW LEVEL SECURITY;

CREATE INDEX posts_owner_updated_idx ON public.posts(owner_id,updated_at DESC,id);
CREATE INDEX comments_owner_idx ON public.comments(owner_id);
CREATE INDEX comments_post_created_idx ON public.comments(post_id,created_at,id);
CREATE INDEX reactions_post_idx ON public.reactions(post_id);
CREATE UNIQUE INDEX favorites_owner_post_key ON public.favorites(owner_id,post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX favorites_owner_project_key ON public.favorites(owner_id,project_id) WHERE project_id IS NOT NULL;
CREATE INDEX favorites_owner_created_idx ON public.favorites(owner_id,created_at DESC,id);
CREATE INDEX favorites_post_idx ON public.favorites(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX favorites_project_idx ON public.favorites(project_id) WHERE project_id IS NOT NULL;

REVOKE ALL ON TABLE public.posts,public.comments,public.reactions,public.favorites FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.posts,public.comments,public.reactions,public.favorites TO authenticated;
GRANT INSERT (owner_id,title,content,domain,category,edition,game_version) ON public.posts TO authenticated;
GRANT UPDATE (title,content,domain,category,edition,game_version) ON public.posts TO authenticated;
GRANT INSERT (owner_id,post_id,content) ON public.comments TO authenticated;
GRANT UPDATE (content) ON public.comments TO authenticated;
GRANT INSERT (owner_id,post_id,kind) ON public.reactions TO authenticated;
GRANT INSERT (owner_id,post_id,project_id) ON public.favorites TO authenticated;
-- Explicit unlike/unfavorite only. No content deletion, TRUNCATE or backend grant.
GRANT DELETE ON public.reactions,public.favorites TO authenticated;

CREATE POLICY posts_select_own ON public.posts FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()) AND visibility='private' AND publication_status='draft');
CREATE POLICY posts_insert_own ON public.posts FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()) AND visibility='private' AND publication_status='draft');
CREATE POLICY posts_update_own ON public.posts FOR UPDATE TO authenticated USING (owner_id=(SELECT auth.uid()) AND visibility='private' AND publication_status='draft') WITH CHECK (owner_id=(SELECT auth.uid()) AND visibility='private' AND publication_status='draft');

CREATE POLICY comments_select_own ON public.comments FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'));
CREATE POLICY comments_insert_own ON public.comments FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'));
CREATE POLICY comments_update_own ON public.comments FOR UPDATE TO authenticated USING (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft')) WITH CHECK (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'));

CREATE POLICY reactions_select_own ON public.reactions FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'));
CREATE POLICY reactions_insert_own ON public.reactions FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'));
CREATE POLICY reactions_delete_own ON public.reactions FOR DELETE TO authenticated USING (owner_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'));

CREATE POLICY favorites_select_own ON public.favorites FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()) AND ((post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft')) OR (project_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private'))));
CREATE POLICY favorites_insert_own ON public.favorites FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()) AND ((post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft')) OR (project_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private'))));
CREATE POLICY favorites_delete_own ON public.favorites FOR DELETE TO authenticated USING (owner_id=(SELECT auth.uid()) AND ((post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft')) OR (project_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private'))));

CREATE FUNCTION minepro_community_internal.guard_community_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $trigger$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Community identity and authorship are immutable';
  END IF;
  IF TG_TABLE_NAME IN ('comments','reactions') THEN
    IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Community parent is immutable';
    END IF;
  END IF;
  IF TG_TABLE_NAME='reactions' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reaction kind is immutable';
    END IF;
  END IF;
  IF TG_TABLE_NAME='favorites' THEN
    IF ROW(NEW.post_id,NEW.project_id) IS DISTINCT FROM ROW(OLD.post_id,OLD.project_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Favorite target is immutable';
    END IF;
  END IF;
  NEW.updated_at:=statement_timestamp()::timestamptz(3);
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION minepro_community_internal.guard_community_update() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER posts_guard_update BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION minepro_community_internal.guard_community_update();
CREATE TRIGGER comments_guard_update BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION minepro_community_internal.guard_community_update();
CREATE TRIGGER reactions_guard_update BEFORE UPDATE ON public.reactions
  FOR EACH ROW EXECUTE FUNCTION minepro_community_internal.guard_community_update();
CREATE TRIGGER favorites_guard_update BEFORE UPDATE ON public.favorites
  FOR EACH ROW EXECUTE FUNCTION minepro_community_internal.guard_community_update();
