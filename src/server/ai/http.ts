import { AIError } from "./errors.ts";

export async function readLimitedJSON(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (!body) throw new AIError("INVALID_INPUT");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new AIError("INVALID_INPUT");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
