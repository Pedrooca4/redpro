import type { Insertable, Updateable } from "kysely";
import type {
  PostsTable,
  CommentsTable,
  ReactionsTable,
  FavoritesTable,
} from "../src/db/community.ts";
import { parseAuthUserId } from "../src/db/profiles.ts";
import { newRecordId, updatedAt } from "../src/db/record-policy.ts";

const owner_id = parseAuthUserId("019535d9-3df7-79fb-b466-fa907fa17f9e");
const post_id = newRecordId();
export const post: Insertable<PostsTable> = {
  owner_id,
  title: "Rascunho",
  content: "Texto privado",
  domain: "SURVIVAL",
  category: "question",
  edition: "BEDROCK",
};
export const comment: Insertable<CommentsTable> = { owner_id, post_id, content: "Privado" };
export const reaction: Insertable<ReactionsTable> = { owner_id, post_id, kind: "like" };
export const favorite: Insertable<FavoritesTable> = { owner_id, post_id };
export const edit: Updateable<CommentsTable> = { content: "Editado", updated_at: updatedAt() };
// @ts-expect-error Authorship is immutable.
export const ownerChange: Updateable<PostsTable> = { owner_id };
// @ts-expect-error Identity is immutable.
export const idChange: Updateable<CommentsTable> = { id: newRecordId() };
// @ts-expect-error A comment cannot move to another post.
export const movedComment: Updateable<CommentsTable> = { post_id };
// @ts-expect-error Reaction targets and kinds are immutable.
export const movedReaction: Updateable<ReactionsTable> = { kind: "like" };
// @ts-expect-error Favorite targets are immutable.
export const movedFavorite: Updateable<FavoritesTable> = { project_id: newRecordId() };
// @ts-expect-error This lot cannot publish even a private status supplied by a client.
export const authority: Insertable<PostsTable> = { ...post, publication_status: "draft" };
// @ts-expect-error No public visibility contract.
export const published: Insertable<PostsTable> = { ...post, visibility: "public" };
// @ts-expect-error External clocks cannot replace database defaults.
export const clock: Insertable<CommentsTable> = { ...comment, created_at: new Date() };
// @ts-expect-error Canonical Minecraft domains only.
export const domain: Insertable<PostsTable> = { ...post, domain: "MODERATOR" };
