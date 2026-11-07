import { createHash } from "node:crypto";

export const DEVELOPMENT_PROJECT_REF = "rdwchjjxaipkufgxlnvh";
export const LEDGER_READER_ROLE = "minepro_ledger_reader";
const SESSION_POOLER = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

export class DatabaseSafetyError extends Error {
  constructor() {
    super("Database configuration or target confirmation refused. See docs/DATABASE.md.");
    this.name = "DatabaseSafetyError";
  }
}

export type DevelopmentDatabaseConfig = {
  environment: "development" | "test";
  provider: "supabase" | "local-test";
  target: string;
  fingerprint: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  authentication: "password" | "temporary";
  caFile?: string;
};

export function readDevelopmentDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DevelopmentDatabaseConfig {
  const refuse = (): never => {
    throw new DatabaseSafetyError();
  };
  // This phase has no database consumer in production or Vercel previews.
  if (env.VERCEL || env.VERCEL_ENV || env.NODE_ENV === "production") refuse();
  const environment = env.REDPRO_DB_ENV;
  if (environment !== "development" && environment !== "test") return refuse();
  let url: URL;
  let user: string;
  let password: string;
  try {
    url = new URL(env.DATABASE_URL ?? "");
    user = decodeURIComponent(url.username);
    password = env.REDPRO_DB_PASSWORD || decodeURIComponent(url.password);
    if (env.REDPRO_DB_PASSWORD && url.password) return refuse();
  } catch {
    return refuse();
  }
  const database = url.pathname.slice(1);
  const host = url.hostname;
  const port = Number(url.port || "5432");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !user ||
    !password ||
    url.hash ||
    !database ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    url.searchParams.getAll("sslmode").length > 1 ||
    (url.searchParams.has("sslmode") &&
      !["require", "verify-full"].includes(url.searchParams.get("sslmode")!))
  )
    refuse();

  const authentication = env.REDPRO_DB_AUTH_MODE || "password";
  if (authentication !== "password" && authentication !== "temporary") return refuse();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const target = env.REDPRO_DB_TARGET_REF ?? "";
  if (environment === "test") {
    if (
      !local ||
      authentication !== "password" ||
      database !== "redpro_test" ||
      target !== "local-test" ||
      env.REDPRO_DB_SSL_CA_FILE
    )
      refuse();
  } else {
    // Only the explicitly confirmed Supabase development project. Never arbitrary hosts.
    if (!/^[a-z]{20}$/.test(target) || database !== "postgres" || port !== 5432) refuse();
    const direct = host === `db.${target}.supabase.co`;
    const session = SESSION_POOLER.test(host);
    if (!direct && !session) refuse();
    if (session && !user.endsWith(`.${target}`)) refuse();
    if (direct && user.includes(".")) refuse();
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ environment, target, host, port, database, user }))
    .digest("hex");
  return {
    environment,
    provider: local ? "local-test" : "supabase",
    target,
    fingerprint,
    host: host.replace(/^\[|\]$/g, ""),
    port,
    database,
    user,
    password,
    authentication,
    ...(env.REDPRO_DB_SSL_CA_FILE ? { caFile: env.REDPRO_DB_SSL_CA_FILE } : {}),
  };
}

export function readInspectionDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DevelopmentDatabaseConfig {
  const config = readDevelopmentDatabaseConfig(env);
  if (config.provider === "local-test") {
    if (config.user !== LEDGER_READER_ROLE) throw new DatabaseSafetyError();
  } else if (
    config.target !== DEVELOPMENT_PROJECT_REF ||
    config.user !== `${LEDGER_READER_ROLE}.${DEVELOPMENT_PROJECT_REF}` ||
    !SESSION_POOLER.test(config.host) ||
    !config.caFile
  ) {
    throw new DatabaseSafetyError();
  }
  return config;
}

export function confirmDatabaseMutation(config: DevelopmentDatabaseConfig, fingerprint?: string) {
  if (config.user.split(".")[0] === LEDGER_READER_ROLE || fingerprint !== config.fingerprint)
    throw new DatabaseSafetyError();
}

// Never serialize driver errors: they can include a URL, SQL, parameters or private rows.
export function safeDatabaseFailure(error: unknown) {
  return {
    event: "database.failed",
    code: error instanceof DatabaseSafetyError ? "DB_SAFETY_REFUSED" : "DB_OPERATION_FAILED",
  } as const;
}
