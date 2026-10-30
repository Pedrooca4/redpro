import type { ColumnType } from "kysely";
import type { Edition, Mode } from "../features/chat/config.ts";
import type { AuthUserId } from "./profiles.ts";
import type { RecordColumns, RecordId } from "./record-policy.ts";

export type ProjectValidationStatus = "draft" | "illustrative" | "reviewed" | "tested";
export type ProjectDifficulty = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

// Application-author contracts. Trusted validation needs a separately authorized
// server operation; these types deliberately expose its metadata as read-only.
export interface ProjectsTable extends RecordColumns {
  owner_id: ColumnType<AuthUserId, AuthUserId, never>;
  title: string;
  description: string;
  domain: Mode;
  category: string;
  edition: Edition;
  version_min: ColumnType<string | null, string | null | undefined, string | null>;
  version_max: ColumnType<string | null, string | null | undefined, string | null>;
  compatibility_notes: ColumnType<string | null, string | null | undefined, string | null>;
  difficulty: ColumnType<
    ProjectDifficulty | null,
    ProjectDifficulty | null | undefined,
    ProjectDifficulty | null
  >;
  prerequisites: ColumnType<string | null, string | null | undefined, string | null>;
  width: ColumnType<number | null, number | null | undefined, number | null>;
  height: ColumnType<number | null, number | null | undefined, number | null>;
  length: ColumnType<number | null, number | null | undefined, number | null>;
  source_url: ColumnType<string | null, string | null | undefined, string | null>;
  author_declared_status: ColumnType<
    ProjectValidationStatus,
    ProjectValidationStatus | undefined,
    ProjectValidationStatus
  >;
  visibility: ColumnType<"private", undefined, never>;
  validation_status: ColumnType<ProjectValidationStatus, undefined, never>;
  validated_by: ColumnType<AuthUserId | null, undefined, never>;
  validated_at: ColumnType<Date | null, undefined, never>;
  validation_evidence: ColumnType<string | null, undefined, never>;
}

export interface ProjectStepsTable extends RecordColumns {
  project_id: ColumnType<RecordId, RecordId, never>;
  sequence: number;
  title: string;
  instructions: string;
}

export interface MaterialsTable extends RecordColumns {
  project_id: ColumnType<RecordId, RecordId, never>;
  item_key: ColumnType<string | null, string | null | undefined, string | null>;
  name: string;
  quantity: number;
  quantity_is_estimate: ColumnType<boolean, boolean | undefined, boolean>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
}

// Discrete item counts, step positions and block dimensions share PostgreSQL int.
export function parseProjectCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new TypeError("Invalid project count");
  return value;
}

// This is an author's claim, never proof or an authorization to validate.
export function parseAuthorDeclaredStatus(value: unknown): ProjectValidationStatus {
  if (value !== "draft" && value !== "illustrative" && value !== "reviewed" && value !== "tested")
    throw new TypeError("Invalid author declaration");
  return value;
}
