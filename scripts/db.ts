import {
  confirmDatabaseMutation,
  readDevelopmentDatabaseConfig,
  safeDatabaseFailure,
} from "../src/config/database.ts";
import { createDevelopmentDatabase, checkDevelopmentConnection } from "../src/db/connection.ts";
import { isInspectionCommand, printDatabaseInspection } from "../src/db/inspection.ts";
import { runDevelopmentMigration } from "../src/db/migrator.ts";

let db: ReturnType<typeof createDevelopmentDatabase> | undefined;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!isInspectionCommand(command) && command !== "up" && command !== "down")
    throw new Error("Invalid database command");
  const config = readDevelopmentDatabaseConfig();
  if (isInspectionCommand(command)) {
    if (args.length) throw new Error("Unexpected arguments");
    await printDatabaseInspection(command, config);
  } else {
    if (
      args.length !== 2 ||
      !args[0]?.startsWith("--confirm-target=") ||
      !args[1]?.startsWith("--migration=")
    )
      throw new Error("Migration confirmation required");
    const confirmation = args[0].slice("--confirm-target=".length);
    confirmDatabaseMutation(config, confirmation);
    db = createDevelopmentDatabase(config);
    console.log(JSON.stringify(await checkDevelopmentConnection(db, config)));
    console.log(
      JSON.stringify(
        await runDevelopmentMigration(
          db,
          config,
          command,
          confirmation,
          args[1].slice("--migration=".length),
        ),
      ),
    );
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
