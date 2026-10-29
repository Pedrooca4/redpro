import "server-only";

// Future server features must use this entry point; never import database code in UI.
export { createDevelopmentDatabase, checkDevelopmentConnection } from "./connection.ts";
export type { Database } from "./connection.ts";
export { newRecordId, parseRecordId, toUtcTimestamp, updatedAt } from "./record-policy.ts";
export type { RecordId, RecordColumns } from "./record-policy.ts";
export { parseAuthUserId } from "./profiles.ts";
export type { AuthUserId, ProfilesTable, ProfilePreferences } from "./profiles.ts";
