-- Existing Kysely transaction only. Refuse any data or unrelated dependency.
LOCK TABLE public.posts,public.comments,public.reactions,public.favorites IN ACCESS EXCLUSIVE MODE;
SET LOCAL row_security=off;
DO $migration$
BEGIN
  IF obj_description('public.posts'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-016 posts v1'
    OR obj_description('public.comments'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-016 comments v1'
    OR obj_description('public.reactions'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-016 reactions v1'
    OR obj_description('public.favorites'::regclass,'pg_class') IS DISTINCT FROM 'MinePRO RED-016 favorites v1'
    OR obj_description('minepro_community_internal'::regnamespace,'pg_namespace') IS DISTINCT FROM 'MinePRO RED-016 internal v1' THEN
    RAISE EXCEPTION 'RED-016 rollback refused: object identity differs';
  END IF;
  IF EXISTS (SELECT 1 FROM public.posts) OR EXISTS (SELECT 1 FROM public.comments) OR EXISTS (SELECT 1 FROM public.reactions) OR EXISTS (SELECT 1 FROM public.favorites) THEN
    RAISE EXCEPTION 'RED-016 rollback refused: community tables are not empty';
  END IF;
END;
$migration$;
DROP TABLE public.favorites;
DROP TABLE public.reactions;
DROP TABLE public.comments;
DROP TABLE public.posts;
DROP FUNCTION minepro_community_internal.guard_community_update();
DROP SCHEMA minepro_community_internal;
