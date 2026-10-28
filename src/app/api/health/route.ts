import { withRequestLogging } from "../../../lib/observability.ts";

export const dynamic = "force-dynamic";
export const GET = withRequestLogging("/api/health", () =>
  Response.json(
    { status: "ok", service: "redpro", version: "0.1.0", scope: "application-only" },
    { headers: { "Cache-Control": "no-store" } },
  ),
);
