import http from "node:http";
import { createAnthropicSdkTransport } from "./anthropicSdkTransport";
import type { AnthropicTransportFailure } from "../../src/engine/dialogue/providers/anthropicProvider";

function failureToHttpStatus(f: AnthropicTransportFailure): number {
  if (f.kind === "offline") return 503;
  if (f.kind === "network") return 502;
  // f.kind === "http"
  const s = f.status ?? 502;
  if (s === 401 || s === 403) return 401;
  if (s === 408) return 408;
  if (s === 429) return 429;
  if (s >= 500) return 502;
  if (s >= 400) return 400;
  return 502;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json), ...extraHeaders });
  res.end(json);
}

export function startRelay(_port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/llm/anthropic") {
      sendJson(res, 404, { error: "not found" }); return;
    }
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) { sendJson(res, 401, { error: "ANTHROPIC_API_KEY not configured" }); return; }

    // Read body
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }

    const transport = createAnthropicSdkTransport(apiKey);
    const result = await transport.send(payload as Parameters<typeof transport.send>[0]);

    if (result.ok) {
      sendJson(res, 200, result.value); return;
    }
    const f = result.error;
    const status = failureToHttpStatus(f);
    const extraHeaders: Record<string, string> = {};
    if (f.kind === "http" && f.status === 429 && f.retryAfterMs !== undefined) {
      extraHeaders["Retry-After"] = String(Math.ceil(f.retryAfterMs / 1000));
    }
    sendJson(res, status, { error: "upstream error" }, extraHeaders);
  });
  return server;
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = parseInt(process.env["RELAY_PORT"] ?? "3001", 10);
  const server = startRelay(port);
  server.listen(port, () => { console.log(`[anthropic-relay] listening on :${port}`); });
}
