import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { AIError } from "./errors.ts";

export const AI_MODEL = "google/gemini-3.5-flash-lite";
const MAX_EVALUATION_MS = 60 * 60 * 1000;
export type AIConfig = {
  apiKey: string;
  model: string;
  redisUrl: string;
  redisToken: string;
  rateSecret: string;
  previewOrigin: string;
  expiresAt: number;
};

// Never use OIDC automatically or reuse any Supabase/Vercel database credentials.
// The budget flag records operator approval. The Gateway enforces its own budget.
export function readAIConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = Date.now(),
): AIConfig | null {
  if (env.MINEPRO_AI_ENABLED !== "true") return null;
  const host = env.VERCEL_URL ?? "";
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? "";
  const until = env.MINEPRO_AI_PREVIEW_UNTIL ?? "";
  const expiresAt = Date.parse(until);
  if (
    env.VERCEL !== "1" ||
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL_TARGET_ENV !== "preview" ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(host) ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    env.MINEPRO_AI_PREVIEW_SHA !== sha ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(until) ||
    !Number.isFinite(expiresAt) ||
    new Date(expiresAt).toISOString() !== until.replace(/Z$/, ".000Z") ||
    expiresAt <= now ||
    expiresAt - now > MAX_EVALUATION_MS ||
    env.MINEPRO_AI_BUDGET_APPROVED !== "true" ||
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    !env.AI_GATEWAY_API_KEY?.trim() ||
    !env.MINEPRO_AI_REDIS_TOKEN?.trim() ||
    !env.MINEPRO_AI_RATE_SECRET ||
    env.MINEPRO_AI_RATE_SECRET.length < 32 ||
    (env.MINEPRO_AI_MODEL && env.MINEPRO_AI_MODEL !== AI_MODEL)
  )
    throw new AIError("UNAVAILABLE");
  let url: URL;
  try {
    url = new URL(env.MINEPRO_AI_REDIS_URL ?? "");
  } catch {
    throw new AIError("UNAVAILABLE");
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.upstash\.io$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AIError("UNAVAILABLE");
  return {
    apiKey: env.AI_GATEWAY_API_KEY.trim(),
    model: AI_MODEL,
    redisUrl: url.origin,
    redisToken: env.MINEPRO_AI_REDIS_TOKEN.trim(),
    rateSecret: env.MINEPRO_AI_RATE_SECRET,
    previewOrigin: `https://${host}`,
    expiresAt,
  };
}

export function isAIAvailable(request: Request): boolean {
  try {
    return readAIConfig()?.previewOrigin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

// Only the Vercel-controlled header is accepted. Raw addresses never reach logs or Redis.
export function requesterKey(request: Request, secret: string): string {
  const address = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  const family = isIP(address);
  if (!family || address.includes("%")) throw new AIError("FORBIDDEN");
  // Canonicalize IPv6 and use the same identity for IPv4 and IPv4-mapped IPv6.
  const ip = family === 4 ? `::ffff:${address}` : address;
  const canonical = new URL(`https://[${ip}]`).hostname;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
