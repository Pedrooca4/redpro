import { X509Certificate } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DatabaseSafetyError,
  readDevelopmentDatabaseConfig,
  safeDatabaseFailure,
} from "../src/config/database.ts";

export const DEVELOPMENT_TARGET = "rdwchjjxaipkufgxlnvh";
export const INSPECTION_COMMANDS = ["target", "check", "status"] as const;
export const EXPECTED_MIGRATIONS = [
  "20261028185150423_development_probe",
  "20261029222313139_profiles",
  "20261030153608225_conversations_messages",
  "20261030162454631_projects",
  "20261030193224693_community",
  "20261030202411736_reports_moderation",
] as const;
function refuse(): never {
  throw new DatabaseSafetyError();
}

export function validateInspectionConnection(env: Readonly<Record<string, string | undefined>>) {
  const config = readDevelopmentDatabaseConfig(env);
  // Separate password source only. Never derive, serialize or log a credential URL.
  if (
    config.environment !== "development" ||
    config.provider !== "supabase" ||
    config.target !== DEVELOPMENT_TARGET ||
    config.user !==
      (config.host === `db.${DEVELOPMENT_TARGET}.supabase.co`
        ? "postgres"
        : `postgres.${DEVELOPMENT_TARGET}`) ||
    !env.REDPRO_DB_PASSWORD ||
    new URL(env.DATABASE_URL!).password ||
    env.RUNNER_DEBUG === "1" ||
    env.ACTIONS_STEP_DEBUG === "true"
  )
    refuse();
  return config;
}

export function validateInspectionCA(pem: string | undefined) {
  if (
    !pem ||
    pem.length > 16_384 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/.test(
      pem,
    )
  )
    refuse();
  try {
    if (!new X509Certificate(pem).ca) refuse();
  } catch {
    refuse();
  }
  return pem;
}

// Child output is untrusted. Print only typed, bounded, explicitly allowed
// metadata after ALL three commands succeed; never forward stdout/stderr.
export function inspectSafeOutput(
  command: (typeof INSPECTION_COMMANDS)[number],
  output: string,
  fingerprint: string,
) {
  if (output.length > 32_768) refuse();
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== (command === "status" ? 2 : 1)) refuse();
  const values: Record<string, unknown>[] = lines.map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      refuse();
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
    return value as Record<string, unknown>;
  });
  const connection = values[0]!;
  const target = command === "target";
  const keys = target
    ? ["event", "provider", "environment", "target", "fingerprint", "connected"]
    : [
        "event",
        "provider",
        "environment",
        "target",
        "fingerprint",
        "readOnly",
        "tlsVerified",
        "postgresMajor",
      ];
  if (
    Object.keys(connection).length !== keys.length ||
    keys.some((key) => !(key in connection)) ||
    connection.event !== (target ? "database.target" : "database.connected") ||
    connection.provider !== "supabase" ||
    connection.environment !== "development" ||
    connection.target !== DEVELOPMENT_TARGET ||
    !/^[a-f0-9]{64}$/.test(fingerprint) ||
    connection.fingerprint !== fingerprint ||
    (target
      ? connection.connected !== false
      : connection.readOnly !== true ||
        connection.tlsVerified !== true ||
        connection.postgresMajor !== 17)
  )
    refuse();
  const safe: unknown[] = [Object.fromEntries(keys.map((key) => [key, connection[key]]))];
  if (command === "status") {
    const status = values[1]!;
    if (
      Object.keys(status).length !== 2 ||
      status.event !== "database.migrations" ||
      !Array.isArray(status.migrations) ||
      status.migrations.length !== EXPECTED_MIGRATIONS.length
    )
      refuse();
    let pending = false;
    const migrations = (status.migrations as unknown[]).map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return refuse();
      const migration = value as Record<string, unknown>;
      if (
        Object.keys(migration).length !== 2 ||
        migration.name !== EXPECTED_MIGRATIONS[index] ||
        typeof migration.applied !== "boolean" ||
        (pending && migration.applied)
      )
        refuse();
      if (!migration.applied) pending = true;
      return { name: EXPECTED_MIGRATIONS[index], applied: migration.applied };
    });
    safe.push({ event: "database.migrations", migrations });
  }
  return safe;
}

async function main() {
  if (process.argv.length !== 2) refuse();
  const config = validateInspectionConnection(process.env);
  const pem = validateInspectionCA(process.env.MINEPRO_DEV_DB_CA_PEM);
  // This file contains ONLY the public server CA, never a private certificate,
  // password, connection URL or .env export. Removed even when a check fails.
  const folder = await mkdtemp(path.join(process.env.RUNNER_TEMP || tmpdir(), "minepro-db-ca-"));
  try {
    const ca = path.join(folder, "server-ca.crt");
    await writeFile(ca, pem, { mode: 0o600, flag: "wx" });
    const childEnv: NodeJS.ProcessEnv = { ...process.env, REDPRO_DB_SSL_CA_FILE: ca };
    delete childEnv.MINEPRO_DEV_DB_CA_PEM;
    const safe: unknown[] = [];
    for (const command of INSPECTION_COMMANDS) {
      // Same implementations as db:target/check/status, with no implicit .env.
      const child = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/db.ts", command],
        {
          env: childEnv,
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 65_536,
        },
      );
      if (child.error || child.signal || child.status !== 0)
        throw new Error("Database inspection failed");
      safe.push(...inspectSafeOutput(command, child.stdout, config.fingerprint));
    }
    for (const event of safe) console.log(JSON.stringify(event));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(JSON.stringify(safeDatabaseFailure(error)));
    process.exitCode = 1;
  }
}
