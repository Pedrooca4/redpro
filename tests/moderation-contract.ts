import type { Insertable, Selectable, Updateable } from "kysely";
import type { ReportsTable, ModerationTable } from "../src/db/moderation.ts";
import { parseAuthUserId } from "../src/db/profiles.ts";
import { newRecordId } from "../src/db/record-policy.ts";
const reporter_id = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
export const report: Insertable<ReportsTable> = {
  reporter_id,
  post_id: newRecordId(),
  reason: "Revisar conteúdo",
};
// @ts-expect-error Reporter cannot assign status, including an explicit open value.
export const insertedStatus: Insertable<ReportsTable> = { ...report, status: "open" };
// @ts-expect-error Receipt identity cannot be replaced.
export const changedId: Updateable<ReportsTable> = { id: newRecordId() };
// @ts-expect-error Reporter identity cannot be changed.
export const changedReporter: Updateable<ReportsTable> = { reporter_id };
// @ts-expect-error Submitted evidence is immutable.
export const changedReason: Updateable<ReportsTable> = { reason: "Rewrite" };
// @ts-expect-error Targets cannot be reassigned.
export const movedTarget: Updateable<ReportsTable> = { comment_id: newRecordId() };
// @ts-expect-error Revision belongs to the audit mechanism.
export const changedRevision: Updateable<ReportsTable> = { revision: 1 };
// @ts-expect-error Status is not an author-write contract.
export const changedStatus: Updateable<ReportsTable> = { status: "resolved" };
// @ts-expect-error No current application moderation writer is approved.
export const actorWrite: Insertable<ModerationTable>["actor_id"] = reporter_id;
// @ts-expect-error Audit rows are append-only, including timestamps.
export const auditUpdateKey: keyof Updateable<ModerationTable> = "updated_at";
export function receipt(row: Selectable<ReportsTable>): string {
  return row.status;
}
export function auditDate(row: Selectable<ModerationTable>): Date {
  return row.created_at;
}
