import type { ColumnType, Selectable } from "kysely";
import type { AuthUserId } from "./profiles.ts";
import { parseRecordId, type RecordColumns, type RecordId } from "./record-policy.ts";

export type ReportStatus = "open" | "in_review" | "resolved" | "dismissed";
export type ReportTarget = { kind: "post" | "comment"; id: RecordId };

export interface ReportsTable extends RecordColumns {
  reporter_id: ColumnType<AuthUserId, AuthUserId, never>;
  post_id: ColumnType<RecordId | null, RecordId | null | undefined, never>;
  comment_id: ColumnType<RecordId | null, RecordId | null | undefined, never>;
  reason: ColumnType<string, string, never>;
  details: ColumnType<string | null, string | null | undefined, never>;
  status: ColumnType<ReportStatus, undefined, never>;
  revision: ColumnType<number, undefined, never>;
}

type ModerationRow = Selectable<RecordColumns> & {
  report_id: RecordId;
  actor_id: AuthUserId;
  sequence: number;
  from_status: ReportStatus;
  to_status: ReportStatus;
  note: string;
};
// No application writer is authorized yet. Future trusted moderation requires
// its own reviewed authorization contract; an actor UUID confers no privileges.
export type ModerationTable = {
  [Key in keyof ModerationRow]: ColumnType<ModerationRow[Key], never, never>;
};

export function parseReportTarget(value: unknown): ReportTarget {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid report target");
  const target = value as Record<string, unknown>;
  if (
    (target.kind !== "post" && target.kind !== "comment") ||
    Object.keys(target).some((key) => key !== "kind" && key !== "id")
  )
    throw new TypeError("Invalid report target");
  return { kind: target.kind, id: parseRecordId(target.id) };
}

export function parseReportReason(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Invalid report reason");
  const reason = value.trim();
  if (!reason || Array.from(reason).length > 160) throw new TypeError("Invalid report reason");
  return reason;
}
