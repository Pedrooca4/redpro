import { createHash } from "node:crypto";

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

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const target = env.REDPRO_DB_TARGET_REF ?? "";
  if (environment === "test") {
    if (
      !local ||
      database !== "redpro_test" ||
      target !== "local-test" ||
      env.REDPRO_DB_SSL_CA_FILE
    )
      refuse();
  } else {
    // Only the explicitly confirmed Supabase development project. Never arbitrary hosts.
    if (!/^[a-z]{20}$/.test(target) || database !== "postgres" || port !== 5432) refuse();
    const direct = host === `db.${target}.supabase.co`;
    const session = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
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
    ...(env.REDPRO_DB_SSL_CA_FILE ? { caFile: env.REDPRO_DB_SSL_CA_FILE } : {}),
  };
}

export function confirmDatabaseMutation(config: DevelopmentDatabaseConfig, fingerprint?: string) {
  if (fingerprint !== config.fingerprint) throw new DatabaseSafetyError();
}

// Never serialize driver errors: they can include a URL, SQL, parameters or private rows.
export function safeDatabaseFailure(error: unknown) {
  return {
    event: "database.failed",
    code: error instanceof DatabaseSafetyError ? "DB_SAFETY_REFUSED" : "DB_OPERATION_FAILED",
  } as const;
}
