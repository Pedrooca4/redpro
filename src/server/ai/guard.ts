import { randomUUID } from "node:crypto";
import type { AIConfig } from "./config.ts";
import { AIError } from "./errors.ts";
import { readLimitedJSON } from "./http.ts";

export const EVALUATION_NAMESPACE = "minepro:ai:evaluation:v2";
export const GUARD_LIMITS = {
  evaluationAttempts: 8,
  perWindow: 5,
  windowSeconds: 600,
  concurrent: 1,
  leaseSeconds: 45,
} as const;

// The owner initializes remaining once. A missing or expiring counter must never refill it.
// Reserve before the model call. Failures after DECR burn an attempt rather than refunding it.
export const ADMIT_SCRIPT = `
local remaining = redis.call('GET', KEYS[1])
if not remaining or not string.match(remaining, '^%d$') or
   tonumber(remaining) > tonumber(ARGV[5]) or redis.call('TTL', KEYS[1]) ~= -1 then
  return {3, 0}
end
if remaining == '0' then return {2, 0} end

local count = redis.call('GET', KEYS[2])
if count then
  local ttl = redis.call('TTL', KEYS[2])
  if not string.match(count, '^[1-9]%d*$') or tonumber(count) > tonumber(ARGV[2]) or
     ttl < 0 or ttl > tonumber(ARGV[3]) then
    return {3, 0}
  end
  if tonumber(count) == tonumber(ARGV[2]) then return {0, math.max(1, ttl)} end
end

local leaseTTL = redis.call('TTL', KEYS[3])
if leaseTTL == -1 or leaseTTL > tonumber(ARGV[4]) then return {3, 0} end
if leaseTTL >= 0 then return {0, math.max(1, leaseTTL)} end

redis.call('DECR', KEYS[1])
if count then
  redis.call('INCR', KEYS[2])
else
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
end
if not redis.call('SET', KEYS[3], ARGV[1], 'NX', 'EX', ARGV[4]) then return {3, 0} end
return {1, 0}
`;
export const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

export type Admission = { release: () => Promise<void> };
export type Admit = (identity: string) => Promise<Admission>;

export function createDurableGuard(
  config: AIConfig,
  transport: typeof fetch = fetch,
  namespace = `${EVALUATION_NAMESPACE}:${new URL(config.previewOrigin).hostname}`,
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
        body: JSON.stringify(parts.map(String)),
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
    const lease = `${prefix}:active`;
    const result = await command([
      "EVAL",
      ADMIT_SCRIPT,
      3,
      `${prefix}:remaining`,
      user,
      lease,
      token,
      GUARD_LIMITS.perWindow,
      GUARD_LIMITS.windowSeconds,
      GUARD_LIMITS.leaseSeconds,
      GUARD_LIMITS.evaluationAttempts,
    ]);
    if (!Array.isArray(result) || result.length !== 2) throw new AIError("UNAVAILABLE");
    const [decision, seconds] = result;
    if (decision === 2 && seconds === 0) throw new AIError("BUDGET_EXHAUSTED");
    if (
      decision === 0 &&
      Number.isInteger(seconds) &&
      seconds >= 1 &&
      seconds <= GUARD_LIMITS.windowSeconds
    )
      throw new AIError("RATE_LIMITED", seconds);
    if (decision !== 1 || seconds !== 0) throw new AIError("UNAVAILABLE");
    return {
      release: async () => {
        await command(["EVAL", RELEASE_SCRIPT, 1, lease, token]);
      },
    };
  };
}
