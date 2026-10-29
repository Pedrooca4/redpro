import { readFile } from "node:fs/promises";
import { sql, type Kysely } from "kysely";

// Freeze migrations in time: do not import the evolving application schema.
export async function up<DB>(db: Kysely<DB>): Promise<void> {
  const text = await readFile(
    new URL("./20261029222313139_profiles.up.sql", import.meta.url),
    "utf8",
  );
  await sql.raw(text).execute(db);
}

export async function down<DB>(db: Kysely<DB>): Promise<void> {
  const text = await readFile(
    new URL("./20261029222313139_profiles.down.sql", import.meta.url),
    "utf8",
  );
  await sql.raw(text).execute(db);
}
