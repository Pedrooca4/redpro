import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import {
  createDurableGuard,
  EVALUATION_NAMESPACE,
  GUARD_LIMITS,
} from "../../src/server/ai/guard.ts";
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
  previewOrigin: "https://minepro-test.vercel.app",
  expiresAt: Number.MAX_SAFE_INTEGER,
};
const transport: typeof fetch = async (url, options) => {
  assert.equal(url, config.redisUrl);
  assert.equal(new Headers(options?.headers).get("authorization"), "Bearer redis-test-fixture");
  const parts = JSON.parse(String(options?.body)) as (string | number)[];
  assert.equal(parts[0], "EVAL");
  assert.ok(parts.every((part) => typeof part === "string"));
  return Response.json({ result: await redis(...parts) });
};
const identity = (n: number) => createHash("sha256").update(`fixture-${n}`).digest("hex");
async function isolated(run: (namespace: string) => Promise<void>) {
  const namespace = `minepro:ai:test:${randomUUID()}`;
  try {
    await redis("SET", `{${namespace}}:remaining`, GUARD_LIMITS.evaluationAttempts, "NX");
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
      await redis("GET", `{${namespace}}:ip:${identity(1)}`),
      String(GUARD_LIMITS.perWindow),
    );
  }));
test("the evaluation consumes exactly eight attempts across instances, without an automatic reset", async () =>
  isolated(async (namespace) => {
    const key = `{${namespace}}:remaining`;
    for (let i = 0; i < GUARD_LIMITS.evaluationAttempts; i++) {
      const admission = await createDurableGuard(config, transport, namespace)(identity(i));
      await admission.release();
    }
    assert.equal(await redis("GET", key), "0");
    assert.equal(await redis("TTL", key), -1);
    await assert.rejects(
      createDurableGuard(config, transport, namespace)(identity(9)),
      (e) => e instanceof AIError && e.code === "BUDGET_EXHAUSTED" && !e.retryAfter,
    );
  }));
test("an expired lease cannot release the replacement owner's lock", async () =>
  isolated(async (namespace) => {
    const admit = createDurableGuard(config, transport, namespace);
    const first = await admit(identity(1));
    const key = `{${namespace}}:active`;
    await redis("PEXPIREAT", key, 1);
    const second = await admit(identity(2));
    await first.release();
    await assert.rejects(
      admit(identity(3)),
      (e) => e instanceof AIError && e.code === "RATE_LIMITED",
    );
    await second.release();
    const third = await admit(identity(3));
    await third.release();
  }));
test("missing, corrupt or expiring evaluation counters do not silently refill the budget", async () =>
  isolated(async (namespace) => {
    const key = `{${namespace}}:remaining`;
    const lease = `{${namespace}}:active`;
    const admit = createDurableGuard(config, transport, namespace);
    for (const value of [null, "wrong-type", "-1", "9", "1.0", "08", "8"]) {
      if (value === null) await redis("DEL", key);
      else if (value === "8") await redis("SET", key, value, "EX", 60);
      else await redis("SET", key, value);
      await assert.rejects(
        admit(identity(1)),
        (e) => e instanceof AIError && e.code === "UNAVAILABLE",
      );
      assert.equal(await redis("GET", key), value);
      assert.equal(await redis("EXISTS", lease), 0);
    }
  }));
test("an admitted attempt is spent even if the caller loses the Redis response", async () =>
  isolated(async (namespace) => {
    const lostResponse: typeof fetch = async (...args) => {
      await transport(...args);
      throw new Error("fixture: connection closed after Redis executed EVAL");
    };
    await assert.rejects(
      createDurableGuard(config, lostResponse, namespace)(identity(1)),
      (e) => e instanceof AIError && e.code === "UNAVAILABLE",
    );
    assert.equal(await redis("GET", `{${namespace}}:remaining`), "7");
    await assert.rejects(
      createDurableGuard(config, transport, namespace)(identity(2)),
      (e) => e instanceof AIError && e.code === "RATE_LIMITED",
    );
  }));
test("the IP window starts on admission and can expire without renewing the evaluation quota", async () =>
  isolated(async (namespace) => {
    const admit = createDurableGuard(config, transport, namespace);
    const identityKey = `{${namespace}}:ip:${identity(1)}`;
    for (let i = 0; i < GUARD_LIMITS.perWindow; i++) await (await admit(identity(1))).release();
    const ttl = Number(await redis("TTL", identityKey));
    assert.ok(ttl > 0 && ttl <= GUARD_LIMITS.windowSeconds);
    await redis("PEXPIREAT", identityKey, 1);
    await (await admit(identity(1))).release();
    assert.equal(await redis("GET", identityKey), "1");
    assert.equal(await redis("GET", `{${namespace}}:remaining`), "2");
  }));

test("another deployment with the same credentials cannot use the approved Preview quota", async () => {
  const host = `test-${randomUUID()}.vercel.app`;
  const prefix = `{${EVALUATION_NAMESPACE}:${host}}`;
  const approved = { ...config, previewOrigin: `https://${host}` };
  const other = { ...config, previewOrigin: `https://other-${host}` };
  try {
    await redis("SET", `${prefix}:remaining`, "8", "NX");
    await assert.rejects(
      createDurableGuard(other, transport)(identity(1)),
      (e) => e instanceof AIError && e.code === "UNAVAILABLE",
    );
    await (await createDurableGuard(approved, transport)(identity(1))).release();
    assert.equal(await redis("GET", `${prefix}:remaining`), "7");
  } finally {
    await redis("DEL", `${prefix}:remaining`, `${prefix}:active`, `${prefix}:ip:${identity(1)}`);
  }
});
