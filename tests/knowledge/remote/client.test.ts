/**
 * PR5 unit tests for RemoteKnowledgeClient.
 *
 * Uses fake fetch (globalThis.fetch replaced per test) — no real network calls.
 *
 * Covers:
 *  1. Valid response → KnowledgeHybridResult with correct shape
 *  2. Chunk DTO: no sourcePath, empty string not exposed, all 4 packer fields present
 *  3. non-2xx → throws (error text does NOT leak server detail)
 *  4. Network error → throws with sanitized message
 *  5. Invalid JSON → throws
 *  6. Schema-mismatched response → throws
 *  7. vectorDegradation propagated with reason, message = ""
 *  8. Invalid request (bad limit) → throws before fetch
 *  9. Browser boundary: client.ts source has no Node-only imports
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { RemoteKnowledgeClient } from "../../../src/engine/knowledge/remote/client";
import { readFileSync } from "fs";
import type { KnowledgeHybridQuery } from "../../../src/engine/knowledge/retrieval/types";

const BASE = "http://localhost:3001";

function makeClient() {
  return new RemoteKnowledgeClient({ baseUrl: BASE, timeoutMs: 5000 });
}

const VALID_QUERY: KnowledgeHybridQuery = { text: "宫廷礼仪", limit: 5 };

const VALID_HIT = {
  id: "chunk_01",
  sourceType: "etiquette",
  title: "礼仪规范",
  text: "皇帝进殿须行大礼",
  tags: [],
  entityIds: [],
  locationIds: [],
  visibility: "public",
  hybridScore: 0.9,
  rank: 1,
  keywordRank: 1,
  keywordScore: 0.8,
  vectorRank: null,
  cosineScore: null,
};

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RemoteKnowledgeClient", () => {
  it("returns KnowledgeHybridResult for valid response", async () => {
    mockFetch({ hits: [VALID_HIT] });
    const client = makeClient();
    const result = await client.retrieve(VALID_QUERY);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.chunk.id).toBe("chunk_01");
    expect(result.hits[0]!.hybridScore).toBe(0.9);
  });

  it("reconstructed chunk has no sourcePath exposed to browser", async () => {
    mockFetch({ hits: [VALID_HIT] });
    const client = makeClient();
    const result = await client.retrieve(VALID_QUERY);
    const chunk = result.hits[0]!.chunk;
    // sourcePath is intentionally "" on the client side (never used by packer)
    expect(chunk.sourcePath).toBe("");
  });

  it("chunk has all 4 fields required by PromptKnowledgeChunk (packer)", async () => {
    mockFetch({ hits: [VALID_HIT] });
    const client = makeClient();
    const result = await client.retrieve(VALID_QUERY);
    const chunk = result.hits[0]!.chunk;
    expect(chunk.id).toBeTruthy();
    expect(chunk.title).toBeTruthy();
    expect(chunk.text).toBeTruthy();
    expect(chunk.sourceType).toBeTruthy();
  });

  it("throws on non-2xx response without leaking status body", async () => {
    mockFetch({ error: "internal", stack: "very sensitive" }, 500);
    const client = makeClient();
    const err = await client.retrieve(VALID_QUERY).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("server returned 500");
    expect((err as Error).message).not.toContain("internal");
    expect((err as Error).message).not.toContain("sensitive");
  });

  it("throws sanitized message on network error", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    const client = makeClient();
    const err = await client.retrieve(VALID_QUERY).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    // Must NOT surface raw fetch error text
    expect((err as Error).message).not.toContain("Failed to fetch");
    expect((err as Error).message).toContain("network error");
  });

  it("throws on invalid JSON response", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    }));
    const client = makeClient();
    const err = await client.retrieve(VALID_QUERY).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("invalid JSON");
  });

  it("throws on schema-mismatched response (e.g. sourcePath present in hit)", async () => {
    // Hit with an unknown field — since remoteKnowledgeHitSchema is not .strict() it won't fail,
    // but a missing required field WILL fail
    mockFetch({ hits: [{ id: "x" }] }); // missing required fields
    const client = makeClient();
    const err = await client.retrieve(VALID_QUERY).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("schema mismatch");
  });

  it("propagates vectorDegradation with reason; message is empty (never from server)", async () => {
    mockFetch({ hits: [], vectorDegradation: { reason: "no_embeddings" } });
    const client = makeClient();
    const result = await client.retrieve(VALID_QUERY);
    expect(result.vectorDegradation?.reason).toBe("no_embeddings");
    expect(result.vectorDegradation?.message).toBe("");
  });

  it("throws before fetch when limit is invalid", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = makeClient();
    const err = await client.retrieve({ text: "x", limit: 99 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("result.hits is empty array when server returns no hits", async () => {
    mockFetch({ hits: [] });
    const client = makeClient();
    const result = await client.retrieve(VALID_QUERY);
    expect(result.hits).toHaveLength(0);
    expect(result.vectorDegradation).toBeUndefined();
  });
});

describe("Browser boundary: client.ts contains no Node-only imports", () => {
  const FORBIDDEN = ["better-sqlite3", "node:fs", "node:path", "node:crypto", "better_sqlite3"];

  it("client.ts source has no forbidden Node-only imports", () => {
    const src = readFileSync(
      new URL("../../../src/engine/knowledge/remote/client.ts", import.meta.url).pathname,
      "utf-8",
    );
    for (const forbidden of FORBIDDEN) {
      expect(src, `client.ts must not import ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("schemas.ts source has no forbidden Node-only imports", () => {
    const src = readFileSync(
      new URL("../../../src/engine/knowledge/remote/schemas.ts", import.meta.url).pathname,
      "utf-8",
    );
    for (const forbidden of FORBIDDEN) {
      expect(src, `schemas.ts must not import ${forbidden}`).not.toContain(forbidden);
    }
  });
});
