import { readFileSync } from "node:fs";
import { Kysely, sql } from "kysely";
import { Pool, type PoolConfig } from "pg";
import { DevelopmentPostgresDialect } from "./migration-lock.ts";
import type { DevelopmentDatabaseConfig } from "../config/database.ts";
import type { ProfilesTable } from "./profiles.ts";
import type { ConversationsTable, MessagesTable } from "./conversations.ts";
import type { ProjectsTable, ProjectStepsTable, MaterialsTable } from "./projects.ts";
import type { PostsTable, CommentsTable, ReactionsTable, FavoritesTable } from "./community.ts";
import type { ReportsTable, ModerationTable } from "./moderation.ts";

// A compile-time contract, not proof that a migration ran in any environment.
export interface Database {
  profiles: ProfilesTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
  projects: ProjectsTable;
  project_steps: ProjectStepsTable;
  materials: MaterialsTable;
  posts: PostsTable;
  comments: CommentsTable;
  reactions: ReactionsTable;
  favorites: FavoritesTable;
  reports: ReportsTable;
  moderation: ModerationTable;
}

export function developmentPoolConfig(
  config: DevelopmentDatabaseConfig,
  options: { readOnly?: boolean } = {},
): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl:
      config.provider === "supabase"
        ? {
            rejectUnauthorized: true,
            ...(config.caFile ? { ca: readFileSync(config.caFile, "utf8") } : {}),
          }
        : false,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    application_name: "redpro-development",
    options: options.readOnly
      ? "-c timezone=UTC -c default_transaction_read_only=on"
      : "-c timezone=UTC",
  };
}

export function createDevelopmentDatabase(
  config: DevelopmentDatabaseConfig,
  options: { readOnly?: boolean } = {},
) {
  const pool = new Pool(developmentPoolConfig(config, options));
  // Idle connection failures must not emit the raw pg error or crash the process.
  pool.on("error", () => console.error('{"event":"database.failed","code":"DB_POOL_IDLE_FAILED"}'));
  return new Kysely<Database>({ dialect: new DevelopmentPostgresDialect({ pool }) });
}

export async function checkDevelopmentConnection(
  db: Kysely<Database>,
  config: DevelopmentDatabaseConfig,
) {
  return db
    .transaction()
    .setAccessMode("read only")
    .execute(async (trx) => {
      const result = await sql<{
        ok: number;
        database: string;
        version: string;
        read_only: string;
      }>`
      select 1 as ok, current_database() as database,
             current_setting('server_version_num') as version,
             current_setting('transaction_read_only') as read_only
    `.execute(trx);
      const row = result.rows[0];
      if (row?.ok !== 1 || row.database !== config.database || row.read_only !== "on")
        throw new Error("Database check failed");
      // Do not return the URL, role, host, password or database contents.
      return {
        event: "database.connected",
        provider: config.provider,
        environment: config.environment,
        target: config.target,
        fingerprint: config.fingerprint,
        readOnly: true,
        tlsVerified: config.provider === "supabase",
        postgresMajor: Math.floor(Number(row.version) / 10000),
      };
    });
}
