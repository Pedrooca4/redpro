import {
  DatabaseSafetyError,
  readInspectionDatabaseConfig,
  safeDatabaseFailure,
} from "../src/config/database.ts";
import { isInspectionCommand, printDatabaseInspection } from "../src/db/inspection.ts";

try {
  const [command, ...args] = process.argv.slice(2);
  if (!isInspectionCommand(command) || args.length) throw new DatabaseSafetyError();
  await printDatabaseInspection(command, readInspectionDatabaseConfig());
} catch (error: unknown) {
  console.error(JSON.stringify(safeDatabaseFailure(error)));
  process.exitCode = 1;
}
