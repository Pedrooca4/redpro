// Compile-only checks for the future profile data-access layer.
import type { Insertable, Selectable, Updateable } from "kysely";
import { parseAuthUserId, type ProfilesTable } from "../src/db/profiles.ts";
import { updatedAt } from "../src/db/record-policy.ts";

export const profileInsert: Insertable<ProfilesTable> = {
  id: parseAuthUserId("c301fc1a-44f5-4140-b786-4965af4a1dad"),
  display_name: "Player",
};
export const profileUpdate: Updateable<ProfilesTable> = {
  preferences: { edition: "JAVA" },
  updated_at: updatedAt(),
};
// @ts-expect-error Auth ID is required; profiles never generate a second identity.
export const missingIdentity: Insertable<ProfilesTable> = { display_name: "Player" };
// @ts-expect-error Identity is immutable.
export const changedIdentity: Updateable<ProfilesTable> = { id: profileInsert.id };
// @ts-expect-error Creation time is immutable.
export const changedCreatedAt: Updateable<ProfilesTable> = { created_at: new Date() };
export const callerTimestamp: Insertable<ProfilesTable> = {
  ...profileInsert,
  // @ts-expect-error Caller-provided insertion timestamps are forbidden.
  created_at: new Date(),
};
// @ts-expect-error JSON preferences must be an object.
export const arrayPreferences: Updateable<ProfilesTable> = { preferences: [] };
export function profileDate(row: Selectable<ProfilesTable>): Date {
  return row.created_at;
}
