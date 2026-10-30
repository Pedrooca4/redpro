// Compile-only storage contracts. SQL grants/RLS remain the authorization layer.
import type { Insertable, Selectable, Updateable } from "kysely";
import type { ConversationsTable, MessagesTable } from "../src/db/conversations.ts";
import { parseAuthUserId } from "../src/db/profiles.ts";
import { newRecordId, updatedAt } from "../src/db/record-policy.ts";

export const conversation: Insertable<ConversationsTable> = {
  owner_id: parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e"),
  title: "Minha construção",
  edition: "JAVA",
  default_mode: "BUILDER",
};
export const message: Insertable<MessagesTable> = {
  conversation_id: newRecordId(),
  role: "assistant",
  sequence: 1,
  content: "Backend-only storage fixture",
  selected_mode: "BUILDER",
};
export const conversationUpdate: Updateable<ConversationsTable> = {
  version: null,
  default_mode: "FARM",
  updated_at: updatedAt(),
};
// @ts-expect-error Ownership cannot be reassigned.
export const changedOwner: Updateable<ConversationsTable> = { owner_id: conversation.owner_id };
// @ts-expect-error Identity cannot change.
export const changedId: Updateable<ConversationsTable> = { id: newRecordId() };
// @ts-expect-error Creation date cannot change.
export const changedCreation: Updateable<MessagesTable> = { created_at: new Date() };
// @ts-expect-error Messages cannot move to another conversation.
export const movedMessage: Updateable<MessagesTable> = { conversation_id: newRecordId() };
// @ts-expect-error Role cannot change.
export const changedRole: Updateable<MessagesTable> = { role: "system" };
// @ts-expect-error Order cannot change.
export const changedOrder: Updateable<MessagesTable> = { sequence: 2 };
// @ts-expect-error Future tool references are IDs, not arbitrary objects.
export const invalidRefs: Insertable<MessagesTable> = { ...message, tool_refs: [{}] };
// @ts-expect-error Sequence is mandatory for the trusted writer.
export const missingOrder: Insertable<MessagesTable> = {
  conversation_id: newRecordId(),
  role: "user",
  content: "x",
  selected_mode: "RED",
};
export const invalidEdition: Insertable<ConversationsTable> = {
  ...conversation,
  // @ts-expect-error UI labels are not the persisted edition enum.
  edition: "JavaMine",
};
// @ts-expect-error Client timestamps cannot override INSERT defaults.
export const insertedClock: Insertable<MessagesTable> = { ...message, created_at: new Date() };
export function selectedMessage(row: Selectable<MessagesTable>): Date {
  return row.updated_at;
}
