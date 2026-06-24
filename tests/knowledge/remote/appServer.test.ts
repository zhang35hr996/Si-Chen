/**
 * PR6 tests for the unified app server (createAppServer).
 *
 * Uses the PRODUCTION `createAppServer()` from server/appServer.ts with
 * injected fake deps — no real API keys or real SQLite paths needed.
 *
 * Covers:
 *   - GET /api/health → 200 { ok, knowledge }
 *   - health.knowledge is false when knowledgeService absent
 *   - health.knowledge is true when knowledgeService present
 *   - Unknown route → 404
 *   - GET /api/knowledge/retrieve → 405 (method check in relay)
 *   - POST /api/knowledge/retrieve without knowledgeService → 503
 *   - POST /api/knowledge/retrieve with knowledgeService → 200
 *   - POST /api/llm/anthropic → delegates to transport
 *   - One route failure doesn't crash the server
 *   - Knowledge route bad JSON → 400 (relay validation)
 *   - Disconnect abort wired through to retriever signal
 *   - Retry-After header forwarded from 429 response
 */
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SqliteKeywordIndex } from "../../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex } from "../../../src/engine/knowledge/vector/sqlite-vector-index";
import { KnowledgeHybridRetriever } from "../../../src/engine/knowledge/retrieval/hybrid-retriever";
import { FakeEmbeddingProvider } from "../embedding/fake-provider";
import { createAppServer } from "../../../server/appServer";
import type { KnowledgeRetrievalService } from "../../../server/knowledge/handler";
import type {
  AnthropicTransport,
  AnthropicTransportResult,
} from "../../../src/engine/dialogue/providers/anthropicProvider";

// ── Fake LLM transport ───────────────────────────────────────────────────────

function makeFakeTransport(
  result: Awaited<ReturnType<AnthropicTransport["send"]>>,
): AnthropicTransport {
  return { send: vi.fn().mockResolvedValue(result) };
}

const OK_RESULT: Awaited<ReturnType<AnthropicTransport["send"]>> = {
  ok: true,
  value: { message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "claude-test", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } } as AnthropicTransportResult,
};

// ── Fake knowledge service ────────────────────────────────────────────────────

const NOOP_KW_LOGGER = { warn: () => {}, error: () => {} };

// ── SQLite fixtures ───────────────────────────────────────────────────────────

let dbPath: string;
let kwIndex: SqliteKeywordIndex;
let vecIndex: SqliteVectorIndex;
let knowledgeService: KnowledgeRetrievalService;

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

async function startServer(deps: Parameters<typeof createAppServer>[0]): Promise<string> {
  server = createAppServer(deps);
  await new Promise<void>((res, rej) => {
    server.listen(0, "127.0.0.1", () => res());
    server.on("error", rej);
  });
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  await new Promise<void>((res) => server.close(() => res()));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  dbPath = join(tmpdir(), `appserver-test-${Date.now()}.db`);
  kwIndex = new SqliteKeywordIndex(dbPath);
  vecIndex = new SqliteVectorIndex(dbPath);
  const fakeProvider = new FakeEmbeddingProvider({ dimensions: 4 });
  knowledgeService = new KnowledgeHybridRetriever(kwIndex, vecIndex, fakeProvider);
});

afterAll(async () => {
  try { vecIndex.close(); } catch { /* ok */ }
  try { kwIndex.close(); } catch { /* ok */ }
  try { rmSync(dbPath); } catch { /* ok */ }
});

afterEach(async () => {
  if (server?.listening) await stopServer();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns 200 { ok: true, knowledge: false } when no knowledge service", async () => {
    baseUrl = await startServer({ llmTransport: makeFakeTransport(OK_RESULT), knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; knowledge: boolean };
    expect(body.ok).toBe(true);
    expect(body.knowledge).toBe(false);
  });

  it("returns knowledge: true when knowledge service is present", async () => {
    baseUrl = await startServer({
      llmTransport: makeFakeTransport(OK_RESULT),
      knowledgeService,
      knowledgeHandlerLogger: NOOP_KW_LOGGER,
    });
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json() as { knowledge: boolean };
    expect(body.knowledge).toBe(true);
  });
});

describe("unknown route", () => {
  it("returns 404", async () => {
    baseUrl = await startServer({ llmTransport: makeFakeTransport(OK_RESULT), knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/knowledge/retrieve", () => {
  it("returns 503 when knowledge service is absent", async () => {
    baseUrl = await startServer({ llmTransport: makeFakeTransport(OK_RESULT), knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { text: "礼仪", limit: 5 } }),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("knowledge_unavailable");
  });

  it("returns 200 with hits when knowledge service is present", async () => {
    baseUrl = await startServer({
      llmTransport: makeFakeTransport(OK_RESULT),
      knowledgeService,
      knowledgeHandlerLogger: NOOP_KW_LOGGER,
    });
    const res = await fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { text: "礼仪", limit: 5, vectorFailureMode: "keyword_only" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(Array.isArray(body.hits)).toBe(true);
  });

  it("GET returns 405 (method check)", async () => {
    baseUrl = await startServer({
      llmTransport: makeFakeTransport(OK_RESULT),
      knowledgeService,
      knowledgeHandlerLogger: NOOP_KW_LOGGER,
    });
    const res = await fetch(`${baseUrl}/api/knowledge/retrieve`);
    expect(res.status).toBe(405);
  });

  it("bad JSON returns 400", async () => {
    baseUrl = await startServer({
      llmTransport: makeFakeTransport(OK_RESULT),
      knowledgeService,
      knowledgeHandlerLogger: NOOP_KW_LOGGER,
    });
    const res = await fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("one knowledge failure doesn't crash the server (health still works)", async () => {
    baseUrl = await startServer({
      llmTransport: makeFakeTransport(OK_RESULT),
      knowledgeService,
      knowledgeHandlerLogger: NOOP_KW_LOGGER,
    });
    const bad = await fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad",
    });
    expect(bad.status).toBe(400);
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
  });
});

describe("POST /api/llm/anthropic", () => {
  const validPayload = {
    model: "claude-opus-4-8",
    max_tokens: 100,
    system: [],
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    tool_choice: { type: "auto" },
  };

  it("delegates to transport and returns 200 on success", async () => {
    const transport = makeFakeTransport(OK_RESULT);
    baseUrl = await startServer({ llmTransport: transport, knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/llm/anthropic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(res.status).toBe(200);
    expect(transport.send).toHaveBeenCalled();
  });

  it("returns 429 and Retry-After when transport returns 429", async () => {
    const transport = makeFakeTransport({
      ok: false,
      error: { kind: "http", status: 429, retryAfterMs: 5000 },
    });
    baseUrl = await startServer({ llmTransport: transport, knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/llm/anthropic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("GET returns 405", async () => {
    baseUrl = await startServer({ llmTransport: makeFakeTransport(OK_RESULT), knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/llm/anthropic`);
    expect(res.status).toBe(405);
  });

  it("bad JSON body returns 400", async () => {
    baseUrl = await startServer({ llmTransport: makeFakeTransport(OK_RESULT), knowledgeHandlerLogger: NOOP_KW_LOGGER });
    const res = await fetch(`${baseUrl}/api/llm/anthropic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});

describe("client disconnect aborts knowledge retriever signal", () => {
  it("abort during retrieval fires the signal passed to retriever", async () => {
    const abortSpy = vi.fn();
    const slowService: KnowledgeRetrievalService = {
      retrieve: async (query) => {
        query.signal?.addEventListener("abort", abortSpy);
        await new Promise((res) => setTimeout(res, 50));
        return { hits: [] };
      },
    };

    baseUrl = await startServer({
      llmTransport: makeFakeTransport(OK_RESULT),
      knowledgeService: slowService,
      knowledgeHandlerLogger: NOOP_KW_LOGGER,
    });

    const controller = new AbortController();
    const fetchPromise = fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { text: "礼仪", limit: 5, vectorFailureMode: "keyword_only" } }),
      signal: controller.signal,
    }).catch(() => {});

    await new Promise((res) => setTimeout(res, 10));
    controller.abort();
    await fetchPromise;
    await new Promise((res) => setTimeout(res, 100));

    expect(abortSpy).toHaveBeenCalled();
  });
});
