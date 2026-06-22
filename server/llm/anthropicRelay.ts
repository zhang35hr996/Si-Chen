import http from "node:http";
import { z } from "zod";
import { createAnthropicSdkTransport } from "./anthropicSdkTransport";
import type {
  AnthropicTransport,
  AnthropicTransportFailure,
  AnthropicRequestPayload,
} from "../../src/engine/dialogue/providers/anthropicProvider";

const MAX_BODY_BYTES = 256 * 1024;

const anthropicRequestPayloadSchema = z.object({
  model: z.string(),
  max_tokens: z.number().int().min(1).max(2000),
  system: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  tools: z.array(z.unknown()),
  tool_choice: z.unknown(),
}).strict();

function failureToHttpStatus(failure: AnthropicTransportFailure): number {
  if (failure.kind === "offline") return 503;
  if (failure.kind === "network") return 502;
  const status = failure.status;
  if (
    status === 400 || status === 401 || status === 402 || status === 403 ||
    status === 404 || status === 408 || status === 413 || status === 422 || status === 429
  ) {
    return status;
  }
  if (status && status >= 500) return status;
  return 502;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...extraHeaders,
  });
  res.end(json);
}

export function createRelayServer(transport: AnthropicTransport): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/llm/anthropic") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    // AbortSignal forwarding: client disconnect cancels upstream
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    // Body size cap
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += buf.byteLength;
      if (size > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: "request body too large" });
        req.destroy();
        return;
      }
      chunks.push(buf);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const parsed = anthropicRequestPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      sendJson(res, 400, { error: "invalid request schema" });
      return;
    }

    const result = await transport.send(parsed.data as AnthropicRequestPayload, {
      signal: controller.signal,
    });

    if (result.ok) {
      sendJson(res, 200, result.value);
      return;
    }
    const f = result.error;
    const status = failureToHttpStatus(f);
    const extraHeaders: Record<string, string> = {};
    if (f.kind === "http" && f.status === 429 && f.retryAfterMs !== undefined) {
      extraHeaders["Retry-After"] = String(Math.ceil(f.retryAfterMs / 1000));
    }
    sendJson(res, status, { error: "upstream error" }, extraHeaders);
  });
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = parseInt(process.env["RELAY_PORT"] ?? "3001", 10);
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("[anthropic-relay] ANTHROPIC_API_KEY is not configured");
    process.exit(1);
  }
  const transport = createAnthropicSdkTransport(apiKey);
  const server = createRelayServer(transport);
  server.listen(port, "127.0.0.1", () => {
    console.log(`[anthropic-relay] listening on http://127.0.0.1:${port}`);
  });
}
