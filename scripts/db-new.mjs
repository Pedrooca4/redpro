import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9_]{0,60}$/.test(name) || process.argv.length !== 3) {
  console.error("Usage: pnpm db:new snake_case_name");
  process.exitCode = 1;
} else {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");
  const directory = new URL("../src/db/migrations/", import.meta.url);
  const filename = `${stamp}_${name}.ts`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL(filename, directory),
    `import type { Kysely } from "kysely";

// Freeze migrations in time: do not import the evolving application schema.
export async function up(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error("Migration up must be implemented and reviewed");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error("Migration down must be implemented and reviewed");
}
`,
    { flag: "wx" },
  );
  console.log("Created " + fileURLToPath(new URL(filename, directory)));
}
