import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { createDurableGuard, GUARD_LIMITS } from "../../src/server/ai/guard.ts";
import { AIError } from "../../src/server/ai/errors.ts";
import { AI_MODEL } from "../../src/server/ai/config.ts";

// Only the isolated Redis service of the CI job. No URL or external credential is accepted.
const container = process.env.MINEPRO_TEST_REDIS_CONTAINER ?? "";
if (
  process.env.CI !== "true" ||
  process.env.REDPRO_DB_ENV !== "test" ||
  process.env.REDPRO_DB_TARGET_REF !== "local-test" ||
  !/^[a-f0-9]{64}$/.test(container)
)
  throw new Error("A disposable CI Redis container is required for this suite.");
const exec = promisify(execFile);
async function redis(...parts: (string | number)[]): Promise<unknown> {
  const { stdout } = await exec("docker", [
    "exec",
    container,
    "redis-cli",
    "--json",
    ...parts.map(String),
  ]);
  return JSON.parse(stdout);
}
const config = {
  apiKey: "unused-fixture",
  model: AI_MODEL,
  redisUrl: "https://fixture.upstash.io",
  redisToken: "redis-test-fixture",
  rateSecret: "unused-fixture",
};
const transport: typeof fetch = async (url, options) => {
  assert.equal(url, config.redisUrl);
  assert.equal(new Headers(options?.headers).get("authorization"), "Bearer redis-test-fixture");
  const parts = JSON.parse(String(options?.body)) as (string | number)[];
  assert.equal(parts[0], "EVAL");
  return Response.json({ result: await redis(...parts) });
};
const identity = (n: number) => createHash("sha256").update(`fixture-${n}`).digest("hex");
async function isolated(run: (namespace: string) => Promise<void>) {
  const namespace = `minepro:ai:test:${randomUUID()}`;
  try {
    await run(namespace);
  } finally {
    await redis(
      "EVAL",
      "local keys=redis.call('KEYS',ARGV[1]); for _,key in ipairs(keys) do redis.call('DEL',key) end return #keys",
      0,
      `{${namespace}}:*`,
    );
  }
}

test("atomic Redis admission allows only one concurrent request per identity across instances", async () =>
  isolated(async (namespace) => {
    const guards = [
      createDurableGuard(config, transport, namespace),
      createDurableGuard(config, transport, namespace),
    ];
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => guards[i % 2]!(identity(1))),
    );
    const admitted = results.filter((r) => r.status === "fulfilled");
    assert.equal(admitted.length, 1);
    for (const r of results)
      if (r.status === "rejected")
        assert.ok(r.reason instanceof AIError && r.reason.code === "RATE_LIMITED");
    await admitted[0]!.value.release();
  }));
test("atomic Redis global concurrency cap also covers different clients and workers", async () =>
  isolated(async (namespace) => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        createDurableGuard(config, transport, namespace)(identity(i)),
      ),
    );
    const admitted = results.filter((r) => r.status === "fulfilled");
    assert.equal(admitted.length, GUARD_LIMITS.concurrent);
    for (const result of admitted) await result.value.release();
  }));
test("Redis quota persists after releasing admission and the sixth attempt is denied", async () =>
  isolated(async (namespace) => {
    const admit = createDurableGuard(config, transport, namespace);
    for (let i = 0; i < GUARD_LIMITS.perWindow; i++) {
      const lease = await admit(identity(1));
      await lease.release();
    }
    await assert.rejects(
      admit(identity(1)),
      (e) => e instanceof AIError && e.code === "RATE_LIMITED" && Number(e.retryAfter) > 0,
    );
    assert.equal(
      await redis("HGET", `{${namespace}}:ip:${identity(1)}`, "count"),
      String(GUARD_LIMITS.perWindow),
    );
  }));
test("Redis shared daily budget denies every client once the approved attempt quota is spent", async () =>
  isolated(async (namespace) => {
    const time = (await redis("TIME")) as string[];
    await redis(
      "HSET",
      `{${namespace}}:daily`,
      "period",
      Math.floor(Number(time[0]) / 86400),
      "count",
      GUARD_LIMITS.perDay,
    );
    for (let i = 0; i < 4; i++)
      await assert.rejects(
        createDurableGuard(config, transport, namespace)(identity(i)),
        (e) => e instanceof AIError && e.code === "RATE_LIMITED",
      );
  }));
test("an expired lease cannot release the replacement owner's lock", async () =>
  isolated(async (namespace) => {
    const admit = createDurableGuard(config, transport, namespace);
    const first = await admit(identity(1));
    const user = `{${namespace}}:ip:${identity(1)}:active`;
    const oldToken = (await redis("GET", user)) as string;
    await redis("DEL", user);
    await redis("ZADD", `{${namespace}}:active`, 0, oldToken);
    const second = await admit(identity(1));
    await first.release();
    await assert.rejects(
      admit(identity(1)),
      (e) => e instanceof AIError && e.code === "RATE_LIMITED",
    );
    await second.release();
    const third = await admit(identity(1));
    await third.release();
  }));
test("corrupt guard metadata fails closed and does not admit a provider request", async () =>
  isolated(async (namespace) => {
    await redis("SET", `{${namespace}}:daily`, "wrong-type");
    await assert.rejects(
      createDurableGuard(config, transport, namespace)(identity(1)),
      (e) => e instanceof AIError && e.code === "UNAVAILABLE",
    );
    assert.equal(await redis("EXISTS", `{${namespace}}:ip:${identity(1)}:active`), 0);
  }));
