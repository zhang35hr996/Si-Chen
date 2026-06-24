/**
 * Unified local development server — routes both LLM and knowledge requests.
 *
 * Routes:
 *   POST /api/llm/anthropic   — Anthropic API relay
 *   POST /api/knowledge/retrieve — Knowledge retrieval
 *   GET  /api/health          — Liveness check
 *   *                         — 404
 *
 * Knowledge host is optional at startup: if KNOWLEDGE_DB_PATH is absent the
 * server starts anyway (LLM route still works) and knowledge requests return
 * 503 instead of crashing. This lets developers run without a built DB.
 *
 * Client disconnect propagation:
 *   Both routes forward an AbortSignal derived from the request so that
 *   upstream embedding and LLM calls are cancelled on disconnect.
 */
import http from "node:http";
import { createAnthropicSdkTransport } from "./llm/anthropicSdkTransport";
import { createKnowledgeRequestHandler } from "./knowledge/relay";
import { createKnowledgeHost, parseKnowledgeHostConfig } from "./knowledge/host";
import type { KnowledgeHost } from "./knowledge/host";

const PORT = parseInt(process.env["RELAY_PORT"] ?? "3001", 10);

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...extra,
  });
  res.end(json);
}

/** Build an AbortController that fires when the client disconnects. */
function makeRequestSignal(req: http.IncomingMessage, res: http.ServerResponse): AbortController {
  const controller = new AbortController();
  req.on("aborted", () => controller.abort());
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  return controller;
}

function startServer(): void {
  // ── LLM relay ──────────────────────────────────────────────────────────────
  const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
  if (!anthropicApiKey) {
    console.error("[app-server] ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  const llmTransport = createAnthropicSdkTransport(anthropicApiKey);

  // ── Knowledge host (optional) ───────────────────────────────────────────────
  let knowledgeHost: KnowledgeHost | null = null;
  const knowledgeDbPath = process.env["KNOWLEDGE_DB_PATH"];
  if (knowledgeDbPath) {
    try {
      const config = parseKnowledgeHostConfig();
      knowledgeHost = createKnowledgeHost(config);
      console.log("[app-server] knowledge host ready");
    } catch (err) {
      // Log classification only — never log API keys, paths, or raw messages
      const kind = err instanceof Error ? err.name : "Error";
      console.error(`[app-server] knowledge host failed to start (${kind}); knowledge route will return 503`);
    }
  } else {
    console.warn("[app-server] KNOWLEDGE_DB_PATH not set — knowledge route disabled");
  }

  // ── Knowledge route handler (pre-built, avoids per-request closure alloc) ──
  const knowledgeHandler = knowledgeHost
    ? createKnowledgeRequestHandler({
        retriever: knowledgeHost.service,
        logger: {
          warn: (msg, ctx) => console.warn(`[knowledge] ${msg}`, ctx ?? ""),
          error: (msg, ctx) => console.error(`[knowledge] ${msg}`, ctx ?? ""),
        },
      })
    : null;

  // ── HTTP server ─────────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "";

    // Health
    if (url === "/api/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, knowledge: knowledgeHost !== null });
      return;
    }

    // Knowledge
    if (url === "/api/knowledge/retrieve") {
      if (!knowledgeHandler) {
        sendJson(res, 503, { error: "knowledge_unavailable", code: "NO_KNOWLEDGE_HOST" });
        return;
      }
      knowledgeHandler(req, res);
      return;
    }

    // LLM — Anthropic
    if (url === "/api/llm/anthropic") {
      await handleLlmAnthropic(req, res, llmTransport);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[app-server] listening on http://127.0.0.1:${PORT}`);
    console.log(`[app-server] routes: /api/llm/anthropic, /api/knowledge/retrieve, /api/health`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = () => {
    server.close(() => {
      knowledgeHost?.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ── LLM Anthropic handler (extracted from anthropicRelay.ts) ─────────────────
import { z } from "zod";
import type {
  AnthropicTransport,
  AnthropicTransportFailure,
  AnthropicRequestPayload,
} from "../src/engine/dialogue/providers/anthropicProvider";

const MAX_LLM_BODY_BYTES = 256 * 1024;

const systemBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  cache_control: z.object({ type: z.literal("ephemeral") }).optional(),
});

const anthropicRequestPayloadSchema = z.object({
  model: z.string(),
  max_tokens: z.number().int().min(1).max(2000),
  system: z.array(systemBlockSchema),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  tools: z.array(z.unknown()),
  tool_choice: z.unknown(),
}).strict();

function llmFailureToStatus(failure: AnthropicTransportFailure): number {
  if (failure.kind === "offline") return 503;
  if (failure.kind === "network") return 502;
  const s = failure.status;
  if (s && (s === 400 || s === 401 || s === 402 || s === 403 || s === 404 ||
    s === 408 || s === 413 || s === 422 || s === 429)) return s;
  if (s && s >= 500) return s;
  return 502;
}

async function handleLlmAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  transport: AnthropicTransport,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const controller = makeRequestSignal(req, res);

  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.byteLength;
    if (size > MAX_LLM_BODY_BYTES) {
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
  const extra: Record<string, string> = {};
  if (f.kind === "http" && f.status === 429 && f.retryAfterMs !== undefined) {
    extra["Retry-After"] = String(Math.ceil(f.retryAfterMs / 1000));
  }
  sendJson(res, llmFailureToStatus(f), { error: "upstream error" }, extra);
}

startServer();
