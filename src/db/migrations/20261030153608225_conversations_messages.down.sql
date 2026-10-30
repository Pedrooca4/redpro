-- Existing Kysely transaction only. Refuse deletion of history or dependencies.
LOCK TABLE public.conversations, public.messages IN ACCESS EXCLUSIVE MODE;
SET LOCAL row_security = off;
DO $migration$
BEGIN
  IF obj_description('public.conversations'::regclass, 'pg_class') IS DISTINCT FROM 'MinePRO RED-014 conversations v1'
    OR obj_description('public.messages'::regclass, 'pg_class') IS DISTINCT FROM 'MinePRO RED-014 messages v1'
    OR obj_description('minepro_chat_internal'::regnamespace, 'pg_namespace') IS DISTINCT FROM 'MinePRO RED-014 internal v1' THEN
    RAISE EXCEPTION 'RED-014 rollback refused: object identity differs';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages) OR EXISTS (SELECT 1 FROM public.conversations) THEN
    RAISE EXCEPTION 'RED-014 rollback refused: chat history is not empty';
  END IF;
END;
$migration$;
DROP TABLE public.messages;
DROP TABLE public.conversations;
DROP FUNCTION minepro_chat_internal.stamp_message_update();
DROP FUNCTION minepro_chat_internal.stamp_conversation_update();
DROP SCHEMA minepro_chat_internal;
