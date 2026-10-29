// Compile-only policy checks; never executed by the runtime test runner.
import type { Insertable, Selectable, Updateable } from "kysely";
import { newRecordId, updatedAt, type RecordColumns } from "../src/db/record-policy.ts";

export const generatedRecord: Insertable<RecordColumns> = {};
export const explicitRecord: Insertable<RecordColumns> = { id: newRecordId() };
export const serverUpdate: Updateable<RecordColumns> = { updated_at: updatedAt() };

// @ts-expect-error caller timestamps cannot override INSERT defaults.
export const insertedClock: Insertable<RecordColumns> = { created_at: new Date() };
// @ts-expect-error IDs cannot change on UPDATE.
export const changedId: Updateable<RecordColumns> = { id: newRecordId() };
// @ts-expect-error creation time cannot change on UPDATE.
export const changedCreation: Updateable<RecordColumns> = { created_at: new Date() };
// @ts-expect-error updates use the database clock, not an application/client Date.
export const callerClock: Updateable<RecordColumns> = { updated_at: new Date() };
// @ts-expect-error unvalidated text is not a RecordId.
export const uncheckedId: Insertable<RecordColumns> = { id: "unvalidated" };

export function selectedDate(record: Selectable<RecordColumns>): Date {
  return record.created_at;
}
