import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  DatabaseSafetyError,
  readDevelopmentDatabaseConfig,
  safeDatabaseFailure,
} from "../src/config/database.ts";

export function validateCodespaceConnection(
  sha: string,
  host: string,
  ca: string,
  authentication: string,
) {
  const target = "rdwchjjxaipkufgxlnvh";
  if (!/^[a-f0-9]{40}$/.test(sha) || !["password", "temporary"].includes(authentication) || !ca)
    throw new DatabaseSafetyError();
  const direct = host === `db.${target}.supabase.co`;
  if (!direct && !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host))
    throw new DatabaseSafetyError();
  const config = readDevelopmentDatabaseConfig({
    DATABASE_URL: `postgresql://${direct ? "postgres" : `postgres.${target}`}@${host}:5432/postgres`,
    REDPRO_DB_PASSWORD: "synthetic-preflight-placeholder-not-a-credential",
    REDPRO_DB_ENV: "development",
    REDPRO_DB_TARGET_REF: target,
    REDPRO_DB_AUTH_MODE: authentication,
  });
  // Only the public server CA is ever read from disk. Reject private keys/bundles.
  const pem = readFileSync(ca, "utf8");
  if (
    pem.length > 16_384 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/.test(
      pem,
    ) ||
    !new X509Certificate(pem).ca
  )
    throw new DatabaseSafetyError();
  return {
    event: "database.private.preflight",
    target,
    fingerprint: config.fingerprint,
    authentication,
    connected: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4) throw new DatabaseSafetyError();
    console.log(
      JSON.stringify(validateCodespaceConnection(args[0]!, args[1]!, args[2]!, args[3]!)),
    );
  } catch (error) {
    console.error(JSON.stringify(safeDatabaseFailure(error)));
    process.exitCode = 1;
  }
}
