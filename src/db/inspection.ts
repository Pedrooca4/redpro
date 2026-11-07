import type { DevelopmentDatabaseConfig } from "../config/database.ts";
import { checkDevelopmentConnection, createDevelopmentDatabase } from "./connection.ts";
import { readDevelopmentMigrationStatus } from "./migrator.ts";

export function isInspectionCommand(
  command: string | undefined,
): command is "target" | "check" | "status" {
  return command === "target" || command === "check" || command === "status";
}

export async function printDatabaseInspection(
  command: "target" | "check" | "status",
  config: DevelopmentDatabaseConfig,
) {
  if (command === "target") {
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
    return;
  }

  const db = createDevelopmentDatabase(config);
  try {
    console.log(JSON.stringify(await checkDevelopmentConnection(db, config)));
    if (command === "status")
      console.log(
        JSON.stringify({
          event: "database.migrations",
          migrations: await readDevelopmentMigrationStatus(db),
        }),
      );
  } finally {
    await db.destroy();
  }
}
