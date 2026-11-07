import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DatabaseSafetyError,
  DEVELOPMENT_PROJECT_REF,
  readDevelopmentDatabaseConfig,
  safeDatabaseFailure,
} from "../src/config/database.ts";
import { createDevelopmentDatabase } from "../src/db/connection.ts";
import { inspectAdministrativeLedger } from "../src/db/admin-inspection.ts";

const repository = "Pedrooca4/redpro";
const directHost = `db.${DEVELOPMENT_PROJECT_REF}.supabase.co`;
const poolerHost = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const allowedOrigins = [
  `https://github.com/${repository}`,
  `https://github.com/${repository}.git`,
  `git@github.com:${repository}.git`,
];

export function administrativeArguments(
  args: string[],
  env: Readonly<Record<string, string | undefined>>,
) {
  const [codespace, sha, host, caPath] = args;
  if (
    args.length !== 4 ||
    !codespace ||
    !/^[a-z0-9][a-z0-9-]+$/.test(codespace) ||
    env.CODESPACES !== "true" ||
    env.CODESPACE_NAME !== codespace ||
    env.GITHUB_REPOSITORY !== repository ||
    !sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !host ||
    (host !== directHost && !poolerHost.test(host)) ||
    !caPath ||
    caPath.startsWith("-") ||
    env.NODE_ENV === "production" ||
    Object.keys(env).some((name) =>
      /^(?:CI$|GITHUB_ACTIONS$|VERCEL|DATABASE_URL$|REDPRO_DB_|SUPABASE_|POSTGRES_|PG[A-Z_]+$|NODE_OPTIONS$|NODE_TLS_|NODE_EXTRA_CA_CERTS$|NODE_DEBUG|SSLKEYLOGFILE$|GIT_(?:DIR$|WORK_TREE$|COMMON_DIR$|INDEX_FILE$|CONFIG|OBJECT_DIRECTORY$|ALTERNATE_OBJECT_DIRECTORIES$|SSL_NO_VERIFY$|TRACE))/.test(
        name,
      ),
    )
  )
    throw new DatabaseSafetyError();
  return { sha, host, caPath };
}

export function verifyAdministrativeCheckout(sha: string, git: (args: string[]) => string) {
  if (
    git(["symbolic-ref", "--quiet", "HEAD"]) !== "refs/heads/main" ||
    git(["rev-parse", "--verify", "HEAD"]) !== sha ||
    git(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]) ||
    /(?:^|\0)[a-zS] /.test(git(["ls-files", "-v", "-z"])) ||
    !allowedOrigins.includes(git(["remote", "get-url", "--all", "origin"])) ||
    git(["ls-remote", "--exit-code", "--refs", "origin", "refs/heads/main"]) !==
      `${sha}\trefs/heads/main`
  )
    throw new DatabaseSafetyError();
}

export function readAdministrativeCa(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16_384) throw new DatabaseSafetyError();
    const pem = readFileSync(fd, "utf8");
    if (
      pem.length > 16_384 ||
      !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/.test(
        pem,
      )
    )
      throw new DatabaseSafetyError();
    const certificate = new X509Certificate(pem);
    const now = Date.now();
    if (
      !certificate.ca ||
      !(certificate.validFromDate.getTime() <= now && now <= certificate.validToDate.getTime())
    )
      throw new DatabaseSafetyError();
    return pem;
  } finally {
    closeSync(fd);
  }
}

export function administrativeDatabaseConfig(host: string, password: string, ca: string) {
  if (host !== directHost && !poolerHost.test(host)) throw new DatabaseSafetyError();
  const user = host === directHost ? "postgres" : `postgres.${DEVELOPMENT_PROJECT_REF}`;
  return {
    ...readDevelopmentDatabaseConfig({
      DATABASE_URL: `postgresql://${user}@${host}:5432/postgres`,
      REDPRO_DB_PASSWORD: password,
      REDPRO_DB_ENV: "development",
      REDPRO_DB_TARGET_REF: DEVELOPMENT_PROJECT_REF,
    }),
    ca,
  };
}

async function hiddenCredential() {
  const terminal = createInterface({
    input: process.stdin,
    output: new Writable({ write: (_chunk, _encoding, done) => done() }),
    terminal: true,
    historySize: 0,
  });
  terminal.once("SIGINT", () => terminal.close());
  try {
    process.stderr.write("Credencial administrativa (entrada oculta): ");
    for await (const line of terminal) {
      if (!line || /[\0\r\n]/.test(line)) throw new DatabaseSafetyError();
      return line;
    }
    throw new DatabaseSafetyError();
  } finally {
    terminal.close();
    process.stderr.write("\n");
  }
}

async function main() {
  const { sha, host, caPath } = administrativeArguments(process.argv.slice(2), process.env);
  if (
    process.versions.node.split(".")[0] !== "24" ||
    !process.stdin.isTTY ||
    !process.stderr.isTTY ||
    realpathSync(process.cwd()) !== realpathSync(repositoryRoot)
  )
    throw new DatabaseSafetyError();

  const git = (args: string[]) =>
    execFileSync(
      "git",
      ["--no-optional-locks", "--no-replace-objects", "-c", "core.fsmonitor=false", ...args],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      },
    ).trimEnd();

  verifyAdministrativeCheckout(sha, git);
  const ca = readAdministrativeCa(caPath);
  let password = await hiddenCredential();
  try {
    verifyAdministrativeCheckout(sha, git);
    const config = administrativeDatabaseConfig(host, password, ca);
    password = "";
    const { provider, environment, target, fingerprint } = config;
    const summary = { provider, environment, target, fingerprint };
    console.log(JSON.stringify({ event: "database.target", ...summary, connected: false }));

    const db = createDevelopmentDatabase(config);
    try {
      const { postgresMajor, ledgerPresent, migrations } = await inspectAdministrativeLedger(db);
      console.log(
        JSON.stringify({
          event: "database.connected",
          ...summary,
          readOnly: true,
          roleVerified: true,
          tlsVerified: true,
          postgresMajor,
        }),
      );
      console.log(JSON.stringify({ event: "database.migrations", ledgerPresent, migrations }));
    } finally {
      config.password = "";
      await db.destroy();
    }
  } finally {
    password = "";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(JSON.stringify(safeDatabaseFailure(error)));
    process.exitCode = 1;
  }
}
