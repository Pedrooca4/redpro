-- Run inside Kysely's transaction. Never remove project data or use CASCADE.
LOCK TABLE public.projects,public.project_steps,public.materials IN ACCESS EXCLUSIVE MODE;
SET LOCAL row_security=off;
DO $migration$
BEGIN
  IF obj_description('public.projects'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-015 projects v1'
    OR obj_description('public.project_steps'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-015 steps v1'
    OR obj_description('public.materials'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-015 materials v1'
    OR obj_description('minepro_project_internal'::regnamespace,'pg_namespace') IS DISTINCT FROM 'MinePRO RED-015 internal v1' THEN
    RAISE EXCEPTION 'RED-015 rollback refused: object identity differs';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects) OR EXISTS (SELECT 1 FROM public.project_steps) OR EXISTS (SELECT 1 FROM public.materials) THEN
    RAISE EXCEPTION 'RED-015 rollback refused: projects are not empty';
  END IF;
END;
$migration$;
DROP TABLE public.materials;
DROP TABLE public.project_steps;
DROP TABLE public.projects;
DROP FUNCTION minepro_project_internal.guard_project_child();
DROP FUNCTION minepro_project_internal.guard_project_update();
DROP SCHEMA minepro_project_internal;
