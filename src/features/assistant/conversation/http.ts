import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { UUID_PATTERN } from "../../../lib/observability.ts";
import { readBody } from "../http.ts";
import {
  CONVERSATION_PATH,
  encodeResponse,
  failure,
  parseConversationInput,
  unavailable,
  type ConversationInput,
  type ConversationResult,
} from "./contracts.ts";
import { createSimulationStore } from "./ledger.ts";
import { createMockProvider } from "./provider.ts";
import { createConversationService, startMeasurement } from "./service.ts";

const COOKIE = "minepro_d1_session";
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const loopbackIps = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

type Environment = {
  NODE_ENV?: string;
  MINEPRO_D1_MOCK?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  VERCEL_URL?: string;
};

export function acceptsLocalSimulation(request: Request, env: Environment): boolean {
  if (
    env.MINEPRO_D1_MOCK !== "1" ||
    (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") ||
    env.VERCEL !== undefined ||
    env.VERCEL_ENV !== undefined ||
    env.VERCEL_TARGET_ENV !== undefined ||
    env.VERCEL_URL !== undefined
  )
    return false;

  const url = URL.parse(request.url);
  const rawHost = request.headers.get("host");
  if (!url || !rawHost || !/^[a-z0-9.:[\]]+$/i.test(rawHost)) return false;
  const host = URL.parse(`http://${rawHost}`);
  if (
    !host ||
    url.protocol !== "http:" ||
    !loopback.has(url.hostname) ||
    !loopback.has(host.hostname) ||
    url.port !== host.port
  )
    return false;

  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const realIp = request.headers.get("x-real-ip");
  return (
    (!origin || origin === host.origin) &&
    (!site || site === "same-origin" || site === "none") &&
    !request.headers.has("forwarded") &&
    (!forwardedHost || forwardedHost === rawHost) &&
    (!forwardedFor || loopbackIps.has(forwardedFor)) &&
    (!forwardedProto || forwardedProto === "http") &&
    (!realIp || loopbackIps.has(realIp))
  );
}

function localSessions() {
  const secret = randomBytes(32);
  const sign = (session: string) =>
    createHmac("sha256", secret).update(session).digest("base64url");

  return {
    issue() {
      const session = randomUUID();
      return `${COOKIE}=${session}.${sign(session)}; HttpOnly; SameSite=Strict; Path=${CONVERSATION_PATH}`;
    },
    read(request: Request) {
      const cookies = (request.headers.get("cookie") ?? "")
        .split(";")
        .map((cookie) => cookie.trim());
      const matching = cookies.filter((cookie) => cookie.startsWith(`${COOKIE}=`));
      if (matching.length !== 1) return null;
      const [session, signature, extra] = matching[0].slice(COOKIE.length + 1).split(".");
      if (
        !UUID_PATTERN.test(session) ||
        !signature ||
        extra !== undefined ||
        !/^[A-Za-z0-9_-]{43}$/.test(signature)
      )
        return null;
      return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(session))) ? session : null;
    },
  };
}

function zeroBudgetService() {
  return createConversationService({
    store: createSimulationStore(),
    provider: createMockProvider(),
    emit: (event) => console.info(JSON.stringify({ event: "minepro.d1.conversation", ...event })),
  });
}

type Service = ReturnType<typeof createConversationService>;

export function createConversationHandler({
  environment = () => process.env,
  createService = zeroBudgetService,
  identify = () => randomUUID(),
}: {
  environment?: () => Environment;
  createService?: () => Service;
  identify?: (request: Request) => string;
} = {}) {
  let local: { sessions: ReturnType<typeof localSessions>; service: Service } | undefined;

  return async function handle(request: Request): Promise<Response> {
    const requestId = identify(request);
    const measurement = startMeasurement();
    const respond = (result: ConversationResult, input?: ConversationInput, cookie?: string) => {
      const { status, envelope } = encodeResponse(requestId, result, input);
      return Response.json(envelope, {
        status,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
          ...(cookie && { "Set-Cookie": cookie }),
        },
      });
    };

    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return respond(failure("UNSUPPORTED_MEDIA_TYPE"));
    let data: unknown;
    try {
      const body = await readBody(request);
      if (body === null) return respond(failure("PAYLOAD_TOO_LARGE"));
      data = JSON.parse(body) as unknown;
    } catch {
      return respond(failure("INVALID_JSON"));
    }
    const input = parseConversationInput(data);
    if (!input) return respond(failure("INVALID_INPUT"));

    try {
      if (!acceptsLocalSimulation(request, environment()))
        return respond(unavailable("FEATURE_DISABLED"), input);
      local ??= { sessions: localSessions(), service: createService() };
      const session = local.sessions.read(request);
      if (!session) return respond(unavailable("SESSION_REQUIRED"), input, local.sessions.issue());
      const { result } = await local.service.execute(
        session,
        input,
        requestId,
        request.signal,
        measurement,
      );
      return respond(result, input);
    } catch {
      return respond(failure("INTERNAL_ERROR"), input);
    }
  };
}
