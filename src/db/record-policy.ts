import { randomUUID } from "node:crypto";
import { sql, type ColumnType } from "kysely";

declare const recordId: unique symbol;
export type RecordId = string & { readonly [recordId]: true };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// For MinePRO-owned records; external identities retain their provider's contract.
export function parseRecordId(value: unknown): RecordId {
  if (typeof value !== "string" || !UUID_V4.test(value))
    throw new TypeError("Invalid record identifier");
  return value.toLowerCase() as RecordId;
}

export function newRecordId(): RecordId {
  return parseRecordId(randomUUID());
}

// pg returns timestamptz as Date. Reject strings (including timezone-less input),
// invalid dates and extended years rather than silently coercing external values.
export function toUtcTimestamp(value: Date): string {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.getUTCFullYear() > 9999
  )
    throw new TypeError("Invalid timestamp");
  return value.toISOString();
}

// Use on every UPDATE in future data-access code, in the same SQL statement.
// Statement time advances even within a transaction; now() would remain frozen.
export function updatedAt() {
  return sql<Date>`statement_timestamp()::timestamptz(3)`;
}

// Defaults belong to future frozen migrations, never to a browser-supplied clock.
// These types prevent application UPDATEs to identity/creation time and reject
// caller-supplied timestamps on INSERT. They are not runtime authorization.
export interface RecordColumns {
  id: ColumnType<RecordId, RecordId | undefined, never>;
  created_at: ColumnType<Date, undefined, never>;
  updated_at: ColumnType<Date, undefined, ReturnType<typeof updatedAt>>;
}
