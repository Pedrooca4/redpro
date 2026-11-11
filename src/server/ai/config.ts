import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { AIError } from "./errors.ts";

export const AI_MODEL = "google/gemini-3.5-flash-lite";
export type AIConfig = {
  apiKey: string;
  model: string;
  redisUrl: string;
  redisToken: string;
  rateSecret: string;
};

// Never use OIDC automatically or reuse any Supabase/Vercel database credentials.
// A server opt-in, approved budget and durable guard are all mandatory.
export function readAIConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AIConfig | null {
  if (env.MINEPRO_AI_ENABLED !== "true") return null;
  if (
    env.VERCEL !== "1" ||
    !["preview", "production"].includes(env.VERCEL_ENV ?? "") ||
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
  };
}

export function isAIAvailable(): boolean {
  try {
    return readAIConfig() !== null;
  } catch {
    return false;
  }
}

// Only the Vercel-controlled header is accepted. Raw addresses never reach logs or Redis.
export function requesterKey(request: Request, secret: string): string {
  const address = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!isIP(address)) throw new AIError("FORBIDDEN");
  return createHmac("sha256", secret).update(address).digest("hex");
}
