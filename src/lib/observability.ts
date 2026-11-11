import { unstable_rethrow } from "./next-control-flow.ts";
import { PUBLIC_ERROR } from "./error-presentation.ts";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const routes = ["/", "/status", "/api/health", "/api/chat"] as const;
type Route = (typeof routes)[number] | "unmatched";
type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "OTHER";
export type RequestContext = { requestId: string; route: Route; method: Method };
type Event = "request.received" | "request.completed" | "request.failed";
type Details = {
  requestId: string;
  route: string;
  method: string;
  status?: number;
  durationMs?: number;
};
export type LogWriter = (line: string) => void;

function safeRoute(value: string): Route {
  return routes.find((route) => route === value) ?? "unmatched";
}
function safeMethod(value: string): Method {
  return (
    (["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const).find(
      (method) => method === value,
    ) ?? "OTHER"
  );
}

// Server module: node:crypto prevents inclusion in browser components.
// Always generate a new ID at the network boundary, ignoring client-supplied IDs.
export function beginRequest(request: Request): RequestContext {
  return {
    requestId: randomUUID(),
    route: safeRoute(new URL(request.url).pathname),
    method: safeMethod(request.method),
  };
}

export function createRequestLogger(write: LogWriter = (line) => console.info(line)) {
  return (event: Event, details: Details): void => {
    // Construct a fresh allowlisted record. Never spread caller objects or serialize errors.
    const safeEvent = ["request.received", "request.completed", "request.failed"].includes(event)
      ? event
      : "request.received";
    const record = {
      timestamp: new Date().toISOString(),
      level: safeEvent === "request.failed" ? "error" : "info",
      event: safeEvent,
      requestId: UUID_PATTERN.test(details.requestId) ? details.requestId : randomUUID(),
      route: safeRoute(details.route),
      method: safeMethod(details.method),
      ...(Number.isInteger(details.status) && details.status! >= 100 && details.status! <= 599
        ? { status: details.status }
        : {}),
      ...(typeof details.durationMs === "number" &&
      Number.isFinite(details.durationMs) &&
      details.durationMs >= 0
        ? { durationMs: Math.round(details.durationMs * 1000) / 1000 }
        : {}),
      ...(safeEvent === "request.failed" ? { errorType: "unhandled" } : {}),
    };
    try {
      write(JSON.stringify(record));
    } catch {
      // A logging sink failure must not change the application response.
    }
  };
}

export const logRequest = createRequestLogger();

export function withRequestLogging(
  route: (typeof routes)[number],
  handler: (request: Request) => Response | Promise<Response>,
  log = logRequest,
) {
  return async (request: Request): Promise<Response> => {
    // This header is overwritten by proxy.ts; only a UUID is accepted as fallback.
    const forwarded = request.headers.get(REQUEST_ID_HEADER);
    const context: RequestContext = {
      requestId: forwarded && UUID_PATTERN.test(forwarded) ? forwarded : randomUUID(),
      route,
      method: safeMethod(request.method),
    };
    const started = performance.now();
    try {
      const response = await handler(request);
      const headers = new Headers(response.headers);
      headers.set(REQUEST_ID_HEADER, context.requestId);
      const result = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      log("request.completed", {
        ...context,
        status: response.status,
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error: unknown) {
      unstable_rethrow(error);
      log("request.failed", { ...context, status: 500, durationMs: performance.now() - started });
      return Response.json(
        { error: { ...PUBLIC_ERROR, requestId: context.requestId } },
        {
          status: 500,
          headers: { "Cache-Control": "no-store", [REQUEST_ID_HEADER]: context.requestId },
        },
      );
    }
  };
}
