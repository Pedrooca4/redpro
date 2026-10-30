-- Existing Kysely transaction only; never erase reports or audit history.
LOCK TABLE public.reports,public.moderation IN ACCESS EXCLUSIVE MODE;
SET LOCAL row_security=off;
DO $migration$
BEGIN
  IF obj_description('public.reports'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-017 reports v1'
    OR obj_description('public.moderation'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-017 audit v1'
    OR obj_description('minepro_moderation_internal'::regnamespace,'pg_namespace') IS DISTINCT FROM 'MinePRO RED-017 internal v1' THEN
    RAISE EXCEPTION 'RED-017 rollback refused: object identity differs';
  END IF;
  IF EXISTS(SELECT 1 FROM public.reports) OR EXISTS(SELECT 1 FROM public.moderation) THEN
    RAISE EXCEPTION 'RED-017 rollback refused: reports or audit are not empty';
  END IF;
END;
$migration$;
DROP TABLE public.moderation;
DROP TABLE public.reports;
DROP FUNCTION minepro_moderation_internal.apply_moderation();
DROP FUNCTION minepro_moderation_internal.guard_moderation();
DROP FUNCTION minepro_moderation_internal.guard_report();
DROP SCHEMA minepro_moderation_internal;
