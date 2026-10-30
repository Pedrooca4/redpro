import { readFile } from "node:fs/promises";
import { sql, type Kysely } from "kysely";

// Frozen SQL; never import the evolving application schema.
export async function up<DB>(db: Kysely<DB>): Promise<void> {
  await sql
    .raw(await readFile(new URL("./20261030193224693_community.up.sql", import.meta.url), "utf8"))
    .execute(db);
}

export async function down<DB>(db: Kysely<DB>): Promise<void> {
  await sql
    .raw(await readFile(new URL("./20261030193224693_community.down.sql", import.meta.url), "utf8"))
    .execute(db);
}
