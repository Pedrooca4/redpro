-- Frozen RED-017. Existing Kysely transaction only; no real migration on build.
DO $migration$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.posts') IS NULL
    OR to_regclass('public.comments') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'RED-017 requires Auth and preceding community schema';
  END IF;
  IF obj_description('public.profiles'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-013 profiles v1'
    OR obj_description('public.posts'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-016 posts v1'
    OR obj_description('public.comments'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-016 comments v1'
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='auth.uid()'::regprocedure AND prorettype='uuid'::regtype)
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls)
    OR NOT has_schema_privilege('authenticated','public','USAGE')
    OR NOT has_schema_privilege('authenticated','auth','USAGE')
    OR NOT has_function_privilege('authenticated','auth.uid()','EXECUTE') THEN
    RAISE EXCEPTION 'RED-017 dependency or session contract differs';
  END IF;
END;
$migration$;
CREATE SCHEMA minepro_moderation_internal;
COMMENT ON SCHEMA minepro_moderation_internal IS 'MinePRO RED-017 internal v1';
REVOKE ALL ON SCHEMA minepro_moderation_internal FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  post_id uuid REFERENCES public.posts(id) ON DELETE RESTRICT,
  comment_id uuid REFERENCES public.comments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason=btrim(reason) AND char_length(reason) BETWEEN 1 AND 160),
  details text CHECK (details IS NULL OR char_length(btrim(details)) BETWEEN 1 AND 8192),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT reports_one_target CHECK (num_nonnulls(post_id,comment_id)=1),
  CONSTRAINT reports_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
COMMENT ON TABLE public.reports IS 'MinePRO RED-017 reports v1';
CREATE INDEX reports_reporter_created_idx ON public.reports(reporter_id,created_at DESC,id);
CREATE INDEX reports_post_idx ON public.reports(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX reports_comment_idx ON public.reports(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX reports_status_updated_idx ON public.reports(status,updated_at,id);

CREATE TABLE public.moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence>0),
  from_status text NOT NULL CHECK (from_status IN ('open','in_review','resolved','dismissed')),
  to_status text NOT NULL CHECK (to_status IN ('open','in_review','resolved','dismissed')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 8192),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT moderation_uuid_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT moderation_report_sequence_key UNIQUE(report_id,sequence),
  CONSTRAINT moderation_transition CHECK (
    (from_status='open' AND to_status IN ('in_review','resolved','dismissed'))
    OR (from_status='in_review' AND to_status IN ('open','resolved','dismissed'))
    OR (from_status IN ('resolved','dismissed') AND to_status='open')
  )
);
COMMENT ON TABLE public.moderation IS 'MinePRO RED-017 audit v1';
CREATE INDEX moderation_actor_idx ON public.moderation(actor_id);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.moderation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reports,public.moderation FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.reports TO authenticated;
GRANT INSERT (reporter_id,post_id,comment_id,reason,details) ON public.reports TO authenticated;
-- No UPDATE/DELETE/TRUNCATE, audit access, moderator role or backend grant.
CREATE POLICY reports_select_receipt ON public.reports FOR SELECT TO authenticated
  USING (reporter_id=(SELECT auth.uid()));
CREATE POLICY reports_insert_visible_target ON public.reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id=(SELECT auth.uid()) AND status='open' AND revision=0 AND (
    (post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.posts p
      WHERE p.id=post_id AND p.owner_id=(SELECT auth.uid()) AND p.visibility='private' AND p.publication_status='draft'))
    OR (comment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.comments c JOIN public.posts p ON p.id=c.post_id
      WHERE c.id=comment_id AND c.owner_id=(SELECT auth.uid()) AND p.owner_id=(SELECT auth.uid())
        AND p.visibility='private' AND p.publication_status='draft'))
  ));
-- Moderation has intentionally NO client policy: default deny even if an
-- accidental table grant is introduced. Future authority requires a separate gate.

CREATE FUNCTION minepro_moderation_internal.guard_report()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $trigger$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Report retention requires a separately authorized operation';
  ELSIF TG_OP='INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'open' OR NEW.revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reports start open without a moderation revision';
    END IF;
    NEW.created_at:=statement_timestamp()::timestamptz(3);
    NEW.updated_at:=NEW.created_at;
  ELSE
    IF ROW(NEW.id,NEW.reporter_id,NEW.post_id,NEW.comment_id,NEW.reason,NEW.details,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.reporter_id,OLD.post_id,OLD.comment_id,OLD.reason,OLD.details,OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Report identity and submission are immutable';
    END IF;
    IF ROW(NEW.status,NEW.revision) IS DISTINCT FROM ROW(OLD.status,OLD.revision) THEN
      IF NEW.revision IS DISTINCT FROM OLD.revision+1 OR NOT EXISTS (
        SELECT 1 FROM public.moderation m WHERE m.report_id=OLD.id AND m.sequence=NEW.revision
          AND m.from_status=OLD.status AND m.to_status=NEW.status
      ) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Report status requires a matching audit event';
      END IF;
    END IF;
    NEW.updated_at:=statement_timestamp()::timestamptz(3);
  END IF;
  RETURN NEW;
END;
$trigger$;

CREATE FUNCTION minepro_moderation_internal.guard_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $trigger$
DECLARE
  current_status text;
  current_revision integer;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Moderation audit is append-only';
  END IF;
  SELECT status,revision INTO current_status,current_revision FROM public.reports WHERE id=NEW.report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Report is not writable';
  END IF;
  IF NEW.sequence IS DISTINCT FROM current_revision+1 OR NEW.from_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Moderation sequence or prior status differs';
  END IF;
  NEW.created_at:=statement_timestamp()::timestamptz(3);
  NEW.updated_at:=NEW.created_at;
  RETURN NEW;
END;
$trigger$;

CREATE FUNCTION minepro_moderation_internal.apply_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $trigger$
BEGIN
  UPDATE public.reports SET status=NEW.to_status,revision=NEW.sequence WHERE id=NEW.report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Report is not writable';
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION minepro_moderation_internal.guard_report(),minepro_moderation_internal.guard_moderation(),minepro_moderation_internal.apply_moderation()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER reports_guard BEFORE INSERT OR UPDATE OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION minepro_moderation_internal.guard_report();
CREATE TRIGGER moderation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.moderation
  FOR EACH ROW EXECUTE FUNCTION minepro_moderation_internal.guard_moderation();
CREATE TRIGGER moderation_apply AFTER INSERT ON public.moderation
  FOR EACH ROW EXECUTE FUNCTION minepro_moderation_internal.apply_moderation();
CREATE TRIGGER reports_no_truncate BEFORE TRUNCATE ON public.reports
  FOR EACH STATEMENT EXECUTE FUNCTION minepro_moderation_internal.guard_report();
CREATE TRIGGER moderation_no_truncate BEFORE TRUNCATE ON public.moderation
  FOR EACH STATEMENT EXECUTE FUNCTION minepro_moderation_internal.guard_moderation();
