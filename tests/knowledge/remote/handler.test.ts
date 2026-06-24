/**
 * PR5 unit tests for the knowledge handler (transport-neutral layer).
 *
 * Uses a fake retriever — no SQLite, no real I/O.
 *
 * Covers:
 *  1. Valid request → 200 with sanitized hits
 *  2. sourcePath absent from response hits
 *  3. Extra field in request → 400 (strict schema)
 *  4. Missing required field → 400
 *  5. Retriever throws → 500 (error logged, not surfaced to client)
 *  6. vectorDegradation reason propagated; message absent in response
 *  7. Logger.error called on retriever failure (silent ignore forbidden)
 *  8. Empty hits → 200 with empty array
 *  9. Score fields pass through
 * 10. Logger does NOT receive raw error message (P1: sensitive data sanitization)
 * 11. Logger context never contains API key / path / raw message
 * 12. RRF params (rrfK, keywordWeight, vectorWeight) forwarded to retriever
 */
import { describe, it, expect, vi } from "vitest";
import { handleKnowledgeRetrieve, type KnowledgeRetrievalService } from "../../../server/knowledge/handler";
import type { KnowledgeHybridResult } from "../../../src/engine/knowledge/retrieval/types";

function makeChunk(id: string) {
  return {
    id,
    sourceType: "etiquette" as const,
    title: `title-${id}`,
    text: "皇帝进殿须行大礼",
    tags: [],
    entityIds: [],
    locationIds: [],
    visibility: "public" as const,
    sourcePath: "/absolute/path/to/court.md",  // must NOT appear in response
  };
}

function makeRetriever(result: KnowledgeHybridResult): KnowledgeRetrievalService {
  return { retrieve: vi.fn().mockResolvedValue(result) };
}

function makeFailingRetriever(err: Error): KnowledgeRetrievalService {
  return { retrieve: vi.fn().mockRejectedValue(err) };
}

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

const MINIMAL_REQUEST = { query: { text: "宫廷礼仪", limit: 5 } };
const NOOP_LOGGER = { warn: () => {}, error: () => {} };

describe("handleKnowledgeRetrieve", () => {
  it("returns 200 with sanitized hits", async () => {
    const retriever = makeRetriever({
      hits: [{
        chunk: makeChunk("c1"),
        hybridScore: 0.9, rank: 1, keywordRank: 1, keywordScore: 0.8, vectorRank: null, cosineScore: null,
      }],
    });
    const result = await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger: NOOP_LOGGER });
    expect(result.status).toBe(200);
    const body = result.body as { hits: Array<Record<string, unknown>> };
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]!.id).toBe("c1");
  });

  it("sourcePath is absent from response hits", async () => {
    const retriever = makeRetriever({
      hits: [{
        chunk: makeChunk("c2"),
        hybridScore: 0.9, rank: 1, keywordRank: null, keywordScore: null, vectorRank: null, cosineScore: null,
      }],
    });
    const result = await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger: NOOP_LOGGER });
    const body = result.body as { hits: Array<Record<string, unknown>> };
    expect(body.hits[0]).not.toHaveProperty("sourcePath");
  });

  it("returns 400 on extra fields in request (strict schema)", async () => {
    const retriever = makeRetriever({ hits: [] });
    const result = await handleKnowledgeRetrieve(
      { query: { text: "x", limit: 5, sql: "DROP TABLE" } },
      { retriever, logger: NOOP_LOGGER },
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 on missing required field", async () => {
    const retriever = makeRetriever({ hits: [] });
    const result = await handleKnowledgeRetrieve(
      { query: { limit: 5 } },
      { retriever, logger: NOOP_LOGGER },
    );
    expect(result.status).toBe(400);
  });

  it("returns 500 when retriever throws (error not surfaced to client)", async () => {
    const retriever = makeFailingRetriever(new Error("disk io error: /secret/path/db.sqlite3"));
    const result = await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger: NOOP_LOGGER });
    expect(result.status).toBe(500);
    const body = result.body as { error: string };
    expect(body.error).not.toContain("disk");
    expect(body.error).not.toContain("secret");
    expect(body.error).not.toContain("sqlite3");
  });

  it("logger.error is called when retriever throws (silent ignore forbidden)", async () => {
    const logger = makeLogger();
    const retriever = makeFailingRetriever(new Error("fatal db error"));
    await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("P1: logger context does NOT contain raw error message with sensitive data", async () => {
    const logger = makeLogger();
    const SENSITIVE = [
      "sk-secret-key-12345",
      "/home/user/.knowledge.db",
      "Authorization: Bearer",
      "SQLITE_CORRUPT: file is not a database",
    ];
    const sensitiveError = new Error(SENSITIVE.join(" | "));
    (sensitiveError as { apiKey?: string }).apiKey = "sk-secret-key-12345";
    const retriever = makeFailingRetriever(sensitiveError);
    await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger });

    // Logger must have been called
    expect(logger.error).toHaveBeenCalled();
    const allLogArgs = JSON.stringify(logger.error.mock.calls);

    for (const sensitive of SENSITIVE) {
      expect(allLogArgs, `logger must not contain: ${sensitive}`).not.toContain(sensitive);
    }
    // Also must not contain the concatenated message
    expect(allLogArgs).not.toContain("sk-secret-key");
    expect(allLogArgs).not.toContain(".knowledge.db");
  });

  it("P1: logger entry for retrieval failure contains code + errorType, not message", async () => {
    const logger = makeLogger();
    const retriever = makeFailingRetriever(new Error("some sensitive detail"));
    await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger });

    const [, ctx] = logger.error.mock.calls[0] as [string, Record<string, string>];
    expect(ctx).toHaveProperty("code");
    expect(ctx).toHaveProperty("errorType");
    expect(ctx).not.toHaveProperty("message");
    expect(JSON.stringify(ctx)).not.toContain("sensitive detail");
  });

  it("propagates vectorDegradation reason; message absent in response", async () => {
    const retriever = makeRetriever({
      hits: [],
      vectorDegradation: { reason: "provider_error", message: "very secret API key error" },
    });
    const result = await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger: NOOP_LOGGER });
    expect(result.status).toBe(200);
    const body = result.body as { vectorDegradation?: { reason: string; message?: string } };
    expect(body.vectorDegradation?.reason).toBe("provider_error");
    expect(body.vectorDegradation).not.toHaveProperty("message");
  });

  it("returns 200 with empty hits when retriever returns empty", async () => {
    const retriever = makeRetriever({ hits: [] });
    const result = await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger: NOOP_LOGGER });
    expect(result.status).toBe(200);
    const body = result.body as { hits: unknown[] };
    expect(body.hits).toHaveLength(0);
  });

  it("passes through all score fields on hit", async () => {
    const retriever = makeRetriever({
      hits: [{
        chunk: makeChunk("c3"),
        hybridScore: 0.77, rank: 2, keywordRank: 3, keywordScore: 0.55, vectorRank: 1, cosineScore: 0.99,
      }],
    });
    const result = await handleKnowledgeRetrieve(MINIMAL_REQUEST, { retriever, logger: NOOP_LOGGER });
    const body = result.body as { hits: Array<Record<string, unknown>> };
    const hit = body.hits[0]!;
    expect(hit.hybridScore).toBe(0.77);
    expect(hit.rank).toBe(2);
    expect(hit.keywordRank).toBe(3);
    expect(hit.keywordScore).toBe(0.55);
    expect(hit.vectorRank).toBe(1);
    expect(hit.cosineScore).toBe(0.99);
  });

  it("P2: RRF params are forwarded to the retriever", async () => {
    const retrieveFn = vi.fn().mockResolvedValue({ hits: [] });
    const retriever: KnowledgeRetrievalService = { retrieve: retrieveFn };
    await handleKnowledgeRetrieve(
      { query: { text: "x", limit: 5, rrfK: 30, keywordWeight: 2, vectorWeight: 0.5 } },
      { retriever, logger: NOOP_LOGGER },
    );
    expect(retrieveFn).toHaveBeenCalledOnce();
    const passedQuery = retrieveFn.mock.calls[0]![0] as { rrfK?: number; keywordWeight?: number; vectorWeight?: number };
    expect(passedQuery.rrfK).toBe(30);
    expect(passedQuery.keywordWeight).toBe(2);
    expect(passedQuery.vectorWeight).toBe(0.5);
  });
});
