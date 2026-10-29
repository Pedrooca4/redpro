-- Run only in the Kysely migration transaction. Never CASCADE or remove user data.
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
-- Never mistake RLS-hidden rows for an empty table. A role that cannot inspect
-- all rows must fail rather than drop data. This setting lasts only this transaction.
SET LOCAL row_security = off;
DO $migration$
BEGIN
  IF obj_description('public.profiles'::regclass, 'pg_class') IS DISTINCT FROM 'MinePRO RED-013 profiles v1'
    OR obj_description('minepro_profile_internal'::regnamespace, 'pg_namespace') IS DISTINCT FROM 'MinePRO RED-013 internal v1' THEN
    RAISE EXCEPTION 'RED-013 rollback refused: object identity differs';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'RED-013 rollback refused: profiles is not empty';
  END IF;
END;
$migration$;
DROP TABLE public.profiles;
DROP FUNCTION minepro_profile_internal.stamp_profile_update();
DROP SCHEMA minepro_profile_internal;
