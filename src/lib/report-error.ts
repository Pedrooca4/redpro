import type { Instrumentation } from "next";
import { createRequestLogger, UUID_PATTERN } from "./observability.ts";
import { randomUUID } from "node:crypto";

export function createErrorReporter(log = createRequestLogger()) {
  const report: Instrumentation.onRequestError = (_error, request) => {
    // Only request metadata enters our logger. Never inspect/serialize the error.
    const rawId = request.headers["x-request-id"];
    const requestId = typeof rawId === "string" && UUID_PATTERN.test(rawId) ? rawId : randomUUID();
    const route =
      ["/", "/status", "/api/health"].find((value) => value === request.path) ?? "unmatched";
    log("request.failed", {
      requestId,
      route,
      method: request.method,
    });
  };
  return report;
}

export const reportError = createErrorReporter();
