import type { ColumnType } from "kysely";
import type { Edition, Mode } from "../features/chat/config.ts";
import type { AuthUserId } from "./profiles.ts";
import { parseRecordId, type RecordColumns, type RecordId } from "./record-policy.ts";

export interface PostsTable extends RecordColumns {
  owner_id: ColumnType<AuthUserId, AuthUserId, never>;
  title: string;
  content: string;
  domain: Mode;
  category: string;
  edition: Edition;
  game_version: ColumnType<string | null, string | null | undefined, string | null>;
  visibility: ColumnType<"private", undefined, never>;
  publication_status: ColumnType<"draft", undefined, never>;
}

export interface CommentsTable extends RecordColumns {
  owner_id: ColumnType<AuthUserId, AuthUserId, never>;
  post_id: ColumnType<RecordId, RecordId, never>;
  content: string;
}

export type ReactionKind = "like";
export interface ReactionsTable extends RecordColumns {
  owner_id: ColumnType<AuthUserId, AuthUserId, never>;
  post_id: ColumnType<RecordId, RecordId, never>;
  kind: ColumnType<ReactionKind, ReactionKind | undefined, never>;
}

// SQL enforces exactly one FK target. Use the discriminated application target
// at future request boundaries; nullable columns alone cannot express XOR.
export interface FavoritesTable extends RecordColumns {
  owner_id: ColumnType<AuthUserId, AuthUserId, never>;
  post_id: ColumnType<RecordId | null, RecordId | null | undefined, never>;
  project_id: ColumnType<RecordId | null, RecordId | null | undefined, never>;
}
export type FavoriteTarget = { kind: "post" | "project"; id: RecordId };

export function parseReactionKind(value: unknown): ReactionKind {
  if (value !== "like") throw new TypeError("Invalid reaction kind");
  return value;
}

export function parseFavoriteTarget(value: unknown): FavoriteTarget {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid favorite target");
  const target = value as Record<string, unknown>;
  if (
    (target.kind !== "post" && target.kind !== "project") ||
    Object.keys(target).some((key) => key !== "kind" && key !== "id")
  )
    throw new TypeError("Invalid favorite target");
  return { kind: target.kind, id: parseRecordId(target.id) };
}
