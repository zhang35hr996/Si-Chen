/**
 * PR5 HTTP-adapter tests for server/knowledge/relay.ts.
 *
 * Spins up a real in-process HTTP server per describe block so we exercise the
 * actual byte-reading, JSON-parsing, method-checking, and body-limit logic.
 *
 * Covers:
 *  1. POST valid request → 200 JSON from handler
 *  2. Non-POST method → 405
 *  3. Malformed JSON body → 400
 *  4. Body over 32 KB → 413
 *  5. Handler error (retriever throws) → 500 with sanitized body
 *  6. Handler status is passed through to HTTP response
 *  7. Content-Type: application/json header on all responses
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createKnowledgeRequestHandler } from "../../../server/knowledge/relay";
import type { KnowledgeRetrievalService, KnowledgeHandlerLogger } from "../../../server/knowledge/handler";
import type { KnowledgeHybridResult } from "../../../src/engine/knowledge/retrieval/types";

const NOOP_LOGGER: KnowledgeHandlerLogger = { warn: () => {}, error: () => {} };

function makeRetriever(result: KnowledgeHybridResult): KnowledgeRetrievalService {
  return { retrieve: async () => result };
}

function makeFailingRetriever(): KnowledgeRetrievalService {
  return { retrieve: async () => { throw new Error("db failure"); } };
}

function startServer(retriever: KnowledgeRetrievalService): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const handler = createKnowledgeRequestHandler({ retriever, logger: NOOP_LOGGER });
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close((e) => e ? rej(e) : res())),
      });
    });
    server.on("error", reject);
  });
}

async function post(url: string, body: string, contentType = "application/json"): Promise<{ status: number; json: unknown; headers: Record<string, string | string[] | undefined> }> {
  const res = await fetch(`${url}/knowledge/retrieve`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  const headers: Record<string, string | undefined> = {};
  res.headers.forEach((value, key) => { headers[key] = value; });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers };
}

const VALID_BODY = JSON.stringify({ query: { text: "宫廷礼仪", limit: 5 } });
const VALID_HIT_RESULT: KnowledgeHybridResult = {
  hits: [{
    chunk: {
      id: "c1", sourceType: "etiquette", title: "礼仪", text: "皇帝进殿须行大礼",
      tags: [], entityIds: [], locationIds: [], visibility: "public",
      sourcePath: "/secret/path.md",
    },
    hybridScore: 0.9, rank: 1, keywordRank: 1, keywordScore: 0.8, vectorRank: null, cosineScore: null,
  }],
};

// ── Test 1: Happy path ──────────────────────────────────────────────────────

describe("relay: valid POST request", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => ({ url, close } = await startServer(makeRetriever(VALID_HIT_RESULT))));
  afterAll(() => close());

  it("returns 200 with hits", async () => {
    const { status, json } = await post(url, VALID_BODY);
    expect(status).toBe(200);
    const body = json as { hits: Array<{ id: string }> };
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]!.id).toBe("c1");
  });

  it("response has Content-Type: application/json", async () => {
    const { headers } = await post(url, VALID_BODY);
    expect(headers["content-type"]).toContain("application/json");
  });

  it("response does not include sourcePath", async () => {
    const { json } = await post(url, VALID_BODY);
    const body = json as { hits: Array<Record<string, unknown>> };
    expect(body.hits[0]).not.toHaveProperty("sourcePath");
  });
});

// ── Test 2: Non-POST method → 405 ───────────────────────────────────────────

describe("relay: non-POST method", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => ({ url, close } = await startServer(makeRetriever({ hits: [] }))));
  afterAll(() => close());

  for (const method of ["GET", "PUT", "DELETE", "PATCH"] as const) {
    it(`${method} → 405`, async () => {
      const res = await fetch(`${url}/knowledge/retrieve`, { method });
      expect(res.status).toBe(405);
    });
  }
});

// ── Test 3: Malformed JSON → 400 ─────────────────────────────────────────────

describe("relay: malformed JSON body", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => ({ url, close } = await startServer(makeRetriever({ hits: [] }))));
  afterAll(() => close());

  it("returns 400 for non-JSON body", async () => {
    const { status } = await post(url, "not json at all");
    expect(status).toBe(400);
  });

  it("returns 400 for truncated JSON", async () => {
    const { status } = await post(url, '{"query": {"text": "hi"');
    expect(status).toBe(400);
  });
});

// ── Test 4: Body over 32 KB → 413 ────────────────────────────────────────────

describe("relay: oversized body", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => ({ url, close } = await startServer(makeRetriever({ hits: [] }))));
  afterAll(() => close());

  it("returns 413 for body over 32 KB", async () => {
    const huge = JSON.stringify({ query: { text: "x".repeat(33 * 1024), limit: 5 } });
    const { status } = await post(url, huge);
    expect(status).toBe(413);
  });
});

// ── Test 5: Retriever failure → 500 ──────────────────────────────────────────

describe("relay: retriever throws → 500", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => ({ url, close } = await startServer(makeFailingRetriever())));
  afterAll(() => close());

  it("returns 500 with sanitized error body", async () => {
    const { status, json } = await post(url, VALID_BODY);
    expect(status).toBe(500);
    const body = json as { error: string; code?: string };
    expect(body.error).toBe("retrieval_failed");
    expect(body.code).toBe("INTERNAL_ERROR");
    // Error body must not contain sensitive words
    expect(JSON.stringify(body)).not.toContain("db failure");
  });
});

// ── Test 6: Schema validation → 400 (handler status passthrough) ─────────────

describe("relay: schema validation failure passes through", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => ({ url, close } = await startServer(makeRetriever({ hits: [] }))));
  afterAll(() => close());

  it("returns 400 when handler returns 400", async () => {
    const { status } = await post(url, JSON.stringify({ query: { text: "x", limit: 5, injected: true } }));
    expect(status).toBe(400);
  });
});
