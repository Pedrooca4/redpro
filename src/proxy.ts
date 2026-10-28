import { NextResponse, type NextRequest } from "next/server.js";
import { beginRequest, logRequest, REQUEST_ID_HEADER } from "./lib/observability.ts";

export function proxy(request: NextRequest) {
  const context = beginRequest(request);
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, context.requestId);
  logRequest("request.received", context);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, context.requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
