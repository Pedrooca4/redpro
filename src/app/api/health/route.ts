export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { status: "ok", service: "redpro", version: "0.1.0", scope: "application-only" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
