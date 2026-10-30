// Compile-only author contracts; SQL grants and RLS enforce runtime authorization.
import type { Insertable, Selectable, Updateable } from "kysely";
import type { ProjectsTable, ProjectStepsTable, MaterialsTable } from "../src/db/projects.ts";
import { parseAuthUserId } from "../src/db/profiles.ts";
import { newRecordId, updatedAt } from "../src/db/record-policy.ts";

export const project: Insertable<ProjectsTable> = {
  owner_id: parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e"),
  title: "Base de exemplo",
  description: "Contrato sintético, não um projeto publicado",
  domain: "BUILDER",
  category: "base",
  edition: "JAVA",
  author_declared_status: "tested", // Declaration only; effective status defaults to draft.
};
export const step: Insertable<ProjectStepsTable> = {
  project_id: newRecordId(),
  sequence: 1,
  title: "Fundação",
  instructions: "Medir a área",
};
export const material: Insertable<MaterialsTable> = {
  project_id: newRecordId(),
  name: "Pedra",
  item_key: "minecraft:stone",
  quantity: 64,
};
export const projectUpdate: Updateable<ProjectsTable> = {
  difficulty: "BEGINNER",
  updated_at: updatedAt(),
};
export const reorderedStep: Updateable<ProjectStepsTable> = {
  sequence: 2,
  updated_at: updatedAt(),
};
// @ts-expect-error Ownership cannot be reassigned.
export const changedOwner: Updateable<ProjectsTable> = { owner_id: project.owner_id };
// @ts-expect-error Author cannot grant effective validation.
export const selfValidated: Updateable<ProjectsTable> = { validation_status: "tested" };
export const insertedValidation: Insertable<ProjectsTable> = {
  ...project,
  // @ts-expect-error Author cannot insert effective validation, even a draft value.
  validation_status: "draft",
};
// @ts-expect-error Reviewer identity is protected, not client metadata.
export const changedReviewer: Updateable<ProjectsTable> = { validated_by: project.owner_id };
// @ts-expect-error Validation evidence is trusted metadata.
export const changedEvidence: Updateable<ProjectsTable> = { validation_evidence: "I tested it" };
// @ts-expect-error This task does not allow publication.
export const publicProject: Insertable<ProjectsTable> = { ...project, visibility: "public" };
// @ts-expect-error Children cannot move between projects.
export const movedStep: Updateable<ProjectStepsTable> = { project_id: newRecordId() };
// @ts-expect-error Child IDs are immutable.
export const changedMaterialId: Updateable<MaterialsTable> = { id: newRecordId() };
// @ts-expect-error Creation time is immutable.
export const changedCreation: Updateable<ProjectsTable> = { created_at: new Date() };
// @ts-expect-error Client clocks cannot override insertion defaults.
export const insertedClock: Insertable<MaterialsTable> = { ...material, updated_at: new Date() };
// @ts-expect-error Canonical domains are the six modes, not UI labels.
export const invalidDomain: Insertable<ProjectsTable> = { ...project, domain: "redstone" };
export function projectDates(row: Selectable<ProjectsTable>): [Date, Date | null] {
  return [row.created_at, row.validated_at];
}
