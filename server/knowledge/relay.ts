/**
 * HTTP adapter for the knowledge retrieval handler.
 *
 * Mirrors the pattern used by server/llm/anthropicRelay.ts:
 *   - Reads body bytes, parses JSON, delegates to the handler
 *   - Writes status + JSON body
 *   - Never exposes internal errors as plain text
 *
 * Note: This relay is a skeleton for PR5. It is not yet wired into
 * any running server. Connection to SQLite-backed KnowledgeHybridRetriever
 * is the composition root (host.ts), deferred to a follow-up PR.
 */
import http from "node:http";
import { handleKnowledgeRetrieve, type KnowledgeHandlerDeps } from "./handler";

const MAX_BODY_BYTES = 32 * 1024; // 32 KB

export function createKnowledgeRequestHandler(
  deps: KnowledgeHandlerDeps,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return async (req, res) => {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === "too_large" ? 413 : 400;
      writeJson(res, code, { error: "bad_request" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      writeJson(res, 400, { error: "invalid_json" });
      return;
    }

    const result = await handleKnowledgeRetrieve(parsed, deps);
    writeJson(res, result.status, result.body);
  };
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0; // free collected memory
          reject(new Error("too_large"));
        }
        // Keep draining so the connection stays open for the 413 response
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    req.on("error", (err) => { if (!tooLarge) reject(err); });
  });
}
