import { randomUUID } from "node:crypto";
import type { AIConfig } from "./config.ts";
import { AIError } from "./errors.ts";
import { readLimitedJSON } from "./http.ts";

export const GUARD_LIMITS = {
  perWindow: 5,
  windowSeconds: 600,
  perDay: 30,
  concurrent: 2,
  leaseSeconds: 45,
} as const;

// Atomic and shared across instances and deployments. Redis TIME avoids host clock drift.
// Every admitted attempt spends quota, including provider failures. There are no refunds.
export const ADMIT_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1])
local day = math.floor(now / 86400)
local window = math.floor(now / tonumber(ARGV[3]))
local daily = 0
local user = 0
if tonumber(redis.call('HGET', KEYS[1], 'period')) == day then daily = tonumber(redis.call('HGET', KEYS[1], 'count')) end
if tonumber(redis.call('HGET', KEYS[2], 'period')) == window then user = tonumber(redis.call('HGET', KEYS[2], 'count')) end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
if daily >= tonumber(ARGV[4]) then return {0, (day + 1) * 86400 - now} end
if user >= tonumber(ARGV[2]) then return {0, (window + 1) * tonumber(ARGV[3]) - now} end
if redis.call('EXISTS', KEYS[4]) == 1 or redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) then return {0, 10} end
redis.call('HSET', KEYS[1], 'period', day, 'count', daily + 1)
redis.call('EXPIRE', KEYS[1], 86500)
redis.call('HSET', KEYS[2], 'period', window, 'count', user + 1)
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]) + 60)
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[6]), ARGV[1])
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]) * 2)
redis.call('SET', KEYS[4], ARGV[1], 'EX', ARGV[6])
return {1, 0}
`;
export const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

export type Admission = { release: () => Promise<void> };
export type Admit = (identity: string) => Promise<Admission>;

export function createDurableGuard(
  config: AIConfig,
  transport: typeof fetch = fetch,
  namespace = "minepro:ai:v1",
): Admit {
  const prefix = `{${namespace}}`;
  async function command(parts: (string | number)[]): Promise<unknown> {
    const signal = AbortSignal.timeout(2000);
    try {
      const response = await transport(config.redisUrl, {
        method: "POST",
        signal,
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${config.redisToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parts),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new AIError("UNAVAILABLE");
      }
      const data = (await readLimitedJSON(response.body, 4096, signal)) as {
        result?: unknown;
        error?: unknown;
      };
      if (!data || data.error !== undefined || data.result === undefined)
        throw new AIError("UNAVAILABLE");
      return data.result;
    } catch {
      throw new AIError("UNAVAILABLE");
    }
  }
  return async (identity) => {
    if (!/^[a-f0-9]{64}$/.test(identity)) throw new AIError("FORBIDDEN");
    const token = randomUUID();
    const user = `${prefix}:ip:${identity}`;
    const shared = `${prefix}:active`;
    const result = await command([
      "EVAL",
      ADMIT_SCRIPT,
      4,
      `${prefix}:daily`,
      user,
      shared,
      `${user}:active`,
      token,
      GUARD_LIMITS.perWindow,
      GUARD_LIMITS.windowSeconds,
      GUARD_LIMITS.perDay,
      GUARD_LIMITS.concurrent,
      GUARD_LIMITS.leaseSeconds,
    ]);
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      ![0, 1].includes(result[0]) ||
      !Number.isInteger(result[1]) ||
      result[1] < 0 ||
      result[1] > 86400
    )
      throw new AIError("UNAVAILABLE");
    if (result[0] === 1 && result[1] !== 0) throw new AIError("UNAVAILABLE");
    if (result[0] === 0) throw new AIError("RATE_LIMITED", Math.max(1, result[1]));
    return {
      release: async () => {
        await command(["EVAL", RELEASE_SCRIPT, 2, shared, `${user}:active`, token]);
      },
    };
  };
}
