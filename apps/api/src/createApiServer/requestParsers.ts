import type { IncomingMessage } from "node:http";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {}

export const readJsonBody = async (
  request: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> => {
  let totalBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const nextChunk = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += nextChunk.length;
    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError("Request body too large.");
    }
    chunks.push(nextChunk);
  }

  const payload = Buffer.concat(chunks).toString("utf8").trim();
  if (payload.length === 0) {
    return null;
  }

  return JSON.parse(payload);
};
