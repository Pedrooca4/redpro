import { PUBLIC_ERROR } from "../../lib/error-presentation.ts";
import {
  isAssistantReply,
  parseAssistantRequest,
  sameContext,
  type AssistantError,
  type AssistantResponse,
} from "./contracts.ts";
import { guide } from "./guide.ts";

// 4,000 UTF-16 units can occupy up to 24 KB when escaped in JSON.
export const MAX_BODY_BYTES = 32 * 1024;

function json(payload: AssistantResponse, status = 200): Response {
  return Response.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

function error(code: AssistantError["code"], text: string, status: number): Response {
  return json({ type: "ERROR", code, text }, status);
}

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function handleAssistant(request: Request, respond = guide): Promise<Response> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json")
    return error("UNSUPPORTED_MEDIA_TYPE", "Envie a pergunta em JSON.", 415);

  let value: unknown;
  try {
    const text = await readBody(request);
    if (text === null)
      return error("PAYLOAD_TOO_LARGE", "O corpo da solicitação excede o limite permitido.", 413);
    value = JSON.parse(text) as unknown;
  } catch {
    return error("INVALID_JSON", "O corpo da solicitação precisa ser um JSON válido.", 400);
  }

  const input = parseAssistantRequest(value);
  if (!input)
    return error(
      "INVALID_INPUT",
      "Confira a mensagem, a edição, a versão e o modo selecionados.",
      400,
    );

  try {
    const result = respond(input);
    if (isAssistantReply(result) && sameContext(result.context, input.context)) return json(result);
  } catch {
    // The public response and the request logger exclude the original error and payload.
  }
  return error("INTERNAL_ERROR", PUBLIC_ERROR.message, 500);
}
