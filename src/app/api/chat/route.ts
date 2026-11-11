import { withRequestLogging } from "../../../lib/observability.ts";
import { isAIAvailable } from "../../../server/ai/config.ts";
import { createChatHandler } from "../../../server/ai/handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const GET = withRequestLogging("/api/chat", () =>
  Response.json({ available: isAIAvailable() }, { headers: { "Cache-Control": "no-store" } }),
);
export const POST = withRequestLogging("/api/chat", createChatHandler());
