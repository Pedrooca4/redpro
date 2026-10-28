import { readDevelopmentDatabaseConfig, safeDatabaseFailure } from "../src/config/database.ts";
import { createDevelopmentDatabase, checkDevelopmentConnection } from "../src/db/connection.ts";
import { migrationStatus, runDevelopmentMigration } from "../src/db/migrator.ts";

let db: ReturnType<typeof createDevelopmentDatabase> | undefined;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!["target", "check", "status", "up", "down"].includes(command ?? ""))
    throw new Error("Invalid database command");
  const config = readDevelopmentDatabaseConfig();
  if (command === "target") {
    if (args.length) throw new Error("Unexpected arguments");
    console.log(
      JSON.stringify({
        event: "database.target",
        provider: config.provider,
        environment: config.environment,
        target: config.target,
        fingerprint: config.fingerprint,
        connected: false,
      }),
    );
  } else {
    if (["check", "status"].includes(command!) && args.length)
      throw new Error("Unexpected arguments");
    if (
      ["up", "down"].includes(command!) &&
      (args.length !== 2 ||
        !args[0]?.startsWith("--confirm-target=") ||
        !args[1]?.startsWith("--migration="))
    )
      throw new Error("Migration confirmation required");
    db = createDevelopmentDatabase(config);
    console.log(JSON.stringify(await checkDevelopmentConnection(db, config)));
    if (command === "status")
      console.log(
        JSON.stringify({ event: "database.migrations", migrations: await migrationStatus(db) }),
      );
    if (command === "up" || command === "down") {
      console.log(
        JSON.stringify(
          await runDevelopmentMigration(
            db,
            config,
            command,
            args[0]!.slice("--confirm-target=".length),
            args[1]!.slice("--migration=".length),
          ),
        ),
      );
    }
  }
} catch (error: unknown) {
  console.error(JSON.stringify(safeDatabaseFailure(error)));
  process.exitCode = 1;
} finally {
  try {
    await db?.destroy();
  } catch {
    console.error('{"event":"database.failed","code":"DB_CLOSE_FAILED"}');
    process.exitCode = 1;
  }
}
