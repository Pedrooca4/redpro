import type { ColumnType } from "kysely";
import type { Edition, Mode } from "../features/chat/config.ts";
import type { AuthUserId } from "./profiles.ts";
import type { RecordColumns, RecordId } from "./record-policy.ts";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ConversationsTable extends RecordColumns {
  owner_id: ColumnType<AuthUserId, AuthUserId, never>;
  title: string;
  edition: Edition;
  version: ColumnType<string | null, string | null | undefined, string | null>;
  default_mode: Mode;
}

// Backend storage contract, NOT a client-authorized INSERT payload. Clients have
// SELECT only on messages; a future trusted backend assigns role and sequence.
export interface MessagesTable extends RecordColumns {
  conversation_id: ColumnType<RecordId, RecordId, never>;
  role: ColumnType<MessageRole, MessageRole, never>;
  sequence: ColumnType<number, number, never>;
  content: string;
  selected_mode: Mode;
  // Native UUIDs on read; no tool_executions FK exists in this stage. Writers
  // must supply validated MinePRO IDs; do not brand unresolved references.
  tool_refs: ColumnType<string[], RecordId[] | undefined, RecordId[]>;
}

export function parseMessageSequence(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new TypeError("Invalid message sequence");
  return value;
}

export function parseMessageRole(value: unknown): MessageRole {
  if (value !== "user" && value !== "assistant" && value !== "system" && value !== "tool")
    throw new TypeError("Invalid message role");
  return value;
}
