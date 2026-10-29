import type { ColumnType, JSONColumnType } from "kysely";
import type { RecordColumns } from "./record-policy.ts";

declare const authUserId: unique symbol;
export type AuthUserId = string & { readonly [authUserId]: true };

// External identity: validate UUID syntax, never generate or require UUID v4.
// The database FK, not this parser, proves that the Auth user actually exists.
export function parseAuthUserId(value: unknown): AuthUserId {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new TypeError("Invalid Auth user identifier");
  return value.toLowerCase() as AuthUserId;
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ProfilePreferences = { [key: string]: JsonValue };

export interface ProfilesTable extends Pick<RecordColumns, "created_at" | "updated_at"> {
  id: ColumnType<AuthUserId, AuthUserId, never>;
  display_name: string;
  preferences: JSONColumnType<
    ProfilePreferences,
    ProfilePreferences | undefined,
    ProfilePreferences
  >;
}
