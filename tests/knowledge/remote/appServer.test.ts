/**
 * PR6 tests for the unified app server routing.
 *
 * Starts a real HTTP server using the relay handler (simulates appServer routing).
 * Full appServer cannot be tested without real ANTHROPIC_API_KEY, so we test:
 *   - The routing layer's behavior for known + unknown paths
 *   - Health endpoint wired through a minimal server
 *   - Unknown route → 404
 *   - Knowledge GET → 405
 *   - One route failure does not crash the server (other routes still work)
 *   - Client disconnect aborts server-side embedding
 */
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SqliteKeywordIndex } from "../../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex } from "../../../src/engine/knowledge/vector/sqlite-vector-index";
import { KnowledgeHybridRetriever } from "../../../src/engine/knowledge/retrieval/hybrid-retriever";
import { createKnowledgeRequestHandler } from "../../../server/knowledge/relay";
import { FakeEmbeddingProvider } from "../embedding/fake-provider";
import type { KnowledgeRetrievalService } from "../../../server/knowledge/handler";

const NOOP_LOGGER = { warn: () => {}, error: () => {} };

let dbPath: string;
let kwIndex: SqliteKeywordIndex;
let vecIndex: SqliteVectorIndex;
let retriever: KnowledgeHybridRetriever;
let baseUrl: string;
let server: http.Server;

// Minimal server that simulates the /api/knowledge and /api/health routes
function createTestServer(knowledgeService: KnowledgeRetrievalService): http.Server {
  const knowledgeHandler = createKnowledgeRequestHandler({
    retriever: knowledgeService,
    logger: NOOP_LOGGER,
  });

  return http.createServer((req, res) => {
    const url = req.url ?? "";

    if (url === "/api/health" && req.method === "GET") {
      const json = JSON.stringify({ ok: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(json);
      return;
    }

    if (url === "/api/knowledge/retrieve") {
      knowledgeHandler(req, res);
      return;
    }

    const json = JSON.stringify({ error: "not_found" });
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(json);
  });
}

beforeAll(async () => {
  dbPath = join(tmpdir(), `appserver-test-${Date.now()}.db`);
  const fakeProvider = new FakeEmbeddingProvider({ dimensions: 4 });
  kwIndex = new SqliteKeywordIndex(dbPath);
  vecIndex = new SqliteVectorIndex(dbPath);
  retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, fakeProvider);

  server = createTestServer(retriever);
  await new Promise<void>((res, rej) => {
    server.listen(0, "127.0.0.1", () => res());
    server.on("error", rej);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
  try { vecIndex.close(); } catch { /* ok */ }
  try { kwIndex.close(); } catch { /* ok */ }
  try { rmSync(dbPath); } catch { /* ok */ }
});

describe("unified server routing", () => {
  it("GET /api/health → 200 { ok: true }", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("unknown route → 404", async () => {
    const res = await fetch(`${baseUrl}/api/unknown`);
    expect(res.status).toBe(404);
  });

  it("GET /api/knowledge/retrieve → 405 (method not allowed)", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge/retrieve`);
    expect(res.status).toBe(405);
  });

  it("valid POST /api/knowledge/retrieve → 200", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { text: "礼仪", limit: 5, vectorFailureMode: "keyword_only" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(Array.isArray(body.hits)).toBe(true);
  });

  it("one knowledge failure does not crash the server (next request still works)", async () => {
    // Bad request — should return 400, not crash
    const badRes = await fetch(`${baseUrl}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(badRes.status).toBe(400);

    // Server still works
    const goodRes = await fetch(`${baseUrl}/api/health`);
    expect(goodRes.status).toBe(200);
  });
});

describe("client disconnect aborts server-side embedding", () => {
  it("aborting the request controller triggers abort on the embedding signal", async () => {
    const abortSpy = vi.fn();
    const slowRetriever: KnowledgeRetrievalService = {
      retrieve: async (_query) => {
        // Simulate slow embedding — check if signal is present and fire spy when aborted
        if (_query.signal) {
          _query.signal.addEventListener("abort", abortSpy);
        }
        // Simulate a 100ms delay to allow the client to disconnect
        await new Promise((res) => setTimeout(res, 50));
        return { hits: [] };
      },
    };

    const slowServer = createTestServer(slowRetriever);
    await new Promise<void>((res, rej) => {
      slowServer.listen(0, "127.0.0.1", () => res());
      slowServer.on("error", rej);
    });
    const slowAddr = slowServer.address() as { port: number };

    const controller = new AbortController();
    // Start request and immediately abort it
    const fetchPromise = fetch(`http://127.0.0.1:${slowAddr.port}/api/knowledge/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { text: "礼仪", limit: 5 } }),
      signal: controller.signal,
    }).catch(() => {}); // expected to throw AbortError

    // Abort after a short delay to let the server start processing
    await new Promise((res) => setTimeout(res, 10));
    controller.abort();
    await fetchPromise;

    // Give server time to propagate the abort signal
    await new Promise((res) => setTimeout(res, 100));
    await new Promise<void>((res) => slowServer.close(() => res()));

    // The abort should have fired (the relay sets up req/res close listeners)
    // This test verifies the wiring exists; actual embedding cancellation is
    // tested at the embedding provider level
    expect(abortSpy).toHaveBeenCalled();
  });
});
