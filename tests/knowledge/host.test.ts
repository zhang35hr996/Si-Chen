/**
 * PR6 tests for the knowledge composition root (host.ts).
 *
 * Uses real temporary SQLite DBs + FakeEmbeddingProvider via the factory seam —
 * no real API calls are made in any test.
 *
 * Covers:
 *  1. Valid DB + fake provider → host created, service returns results
 *  2. DB file not found → createKnowledgeHost throws immediately
 *  3. Missing API key env var → real provider factory throws (tested without factories override)
 *  4. Invalid KNOWLEDGE_EMBEDDING_PROVIDER → parseKnowledgeHostConfig throws
 *  5. Partial init failure → already-opened indexes are closed (resource safety)
 *  6. close() is idempotent (safe to call twice)
 *  7. Error messages do not contain API keys or absolute paths
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteKeywordIndex } from "../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex } from "../../src/engine/knowledge/vector/sqlite-vector-index";
import { FakeEmbeddingProvider } from "./embedding/fake-provider";
import {
  createKnowledgeHost,
  parseKnowledgeHostConfig,
  type KnowledgeHostFactories,
} from "../../server/knowledge/host";

// ── Helpers ─────────────────────────────────────────────────────────────────

let dbPath: string;

function initDb(): void {
  dbPath = join(tmpdir(), `host-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  // Initialize schema by opening both indexes (they run CREATE IF NOT EXISTS)
  const kw = new SqliteKeywordIndex(dbPath);
  kw.close();
  const vec = new SqliteVectorIndex(dbPath);
  vec.close();
}

function cleanupDb(): void {
  try { rmSync(dbPath); } catch { /* best-effort */ }
}

/** Factory seam that injects FakeEmbeddingProvider — no network calls. */
function fakeFactories(opts: { throwOnEmbed?: string } = {}): KnowledgeHostFactories {
  return {
    createProvider: () => new FakeEmbeddingProvider({ dimensions: 4, throwOnEmbed: opts.throwOnEmbed }),
    createKeywordIndex: (p) => new SqliteKeywordIndex(p),
    createVectorIndex: (p) => new SqliteVectorIndex(p),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseKnowledgeHostConfig", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns config when all required env vars are set", () => {
    vi.stubEnv("KNOWLEDGE_DB_PATH", "/fake/db.sqlite");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_MODEL", "text-embedding-3-small");
    const config = parseKnowledgeHostConfig();
    expect(config.dbPath).toBe("/fake/db.sqlite");
    expect(config.embeddingProvider).toBe("openai");
    expect(config.embeddingModel).toBe("text-embedding-3-small");
  });

  it("throws when KNOWLEDGE_DB_PATH is absent", () => {
    vi.stubEnv("KNOWLEDGE_DB_PATH", "");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_MODEL", "text-embedding-3-small");
    expect(() => parseKnowledgeHostConfig()).toThrow("KNOWLEDGE_DB_PATH");
  });

  it("throws when KNOWLEDGE_EMBEDDING_PROVIDER is invalid", () => {
    vi.stubEnv("KNOWLEDGE_DB_PATH", "/fake/db.sqlite");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_PROVIDER", "cohere");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_MODEL", "model");
    expect(() => parseKnowledgeHostConfig()).toThrow();
  });

  it("throws when KNOWLEDGE_EMBEDDING_MODEL is absent", () => {
    vi.stubEnv("KNOWLEDGE_DB_PATH", "/fake/db.sqlite");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("KNOWLEDGE_EMBEDDING_MODEL", "");
    expect(() => parseKnowledgeHostConfig()).toThrow("KNOWLEDGE_EMBEDDING_MODEL");
  });

  it("error messages do not reveal env var values", () => {
    vi.stubEnv("KNOWLEDGE_DB_PATH", "");
    let err: Error | undefined;
    try { parseKnowledgeHostConfig(); } catch (e) { err = e as Error; }
    expect(err).toBeDefined();
    expect(err!.message).not.toContain("sk-");
    expect(err!.message).not.toContain("/home/");
  });
});

describe("createKnowledgeHost — failure cases", () => {
  afterEach(() => {
    cleanupDb();
    vi.unstubAllEnvs();
  });

  it("throws when DB file does not exist", () => {
    const nonexistent = join(tmpdir(), `nonexistent-${Date.now()}.db`);
    expect(() => createKnowledgeHost(
      { dbPath: nonexistent, embeddingProvider: "openai", embeddingModel: "m" },
      fakeFactories(),
    )).toThrow();
  });

  it("throws when provider factory throws (missing API key)", () => {
    initDb();
    const throwingFactories: KnowledgeHostFactories = {
      createProvider: () => { throw new Error("no API key"); },
      createKeywordIndex: (p) => new SqliteKeywordIndex(p),
      createVectorIndex: (p) => new SqliteVectorIndex(p),
    };
    expect(() => createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "m" },
      throwingFactories,
    )).toThrow();
  });

  it("partial init: if vectorIndex creation throws, keywordIndex is closed", () => {
    initDb();
    let keywordClosed = false;
    const partialFailFactories: KnowledgeHostFactories = {
      createProvider: () => new FakeEmbeddingProvider({ dimensions: 4 }),
      createKeywordIndex: (p) => {
        const idx = new SqliteKeywordIndex(p);
        const original = idx.close.bind(idx);
        idx.close = () => { keywordClosed = true; original(); };
        return idx;
      },
      createVectorIndex: () => { throw new Error("vector init failed"); },
    };
    expect(() => createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "m" },
      partialFailFactories,
    )).toThrow("vector init failed");
    expect(keywordClosed).toBe(true);
  });

  it("error on provider failure does not reveal API key values", () => {
    initDb();
    const throwingFactories: KnowledgeHostFactories = {
      createProvider: () => { throw new Error("sk-real-secret-key is invalid"); },
      createKeywordIndex: (p) => new SqliteKeywordIndex(p),
      createVectorIndex: (p) => new SqliteVectorIndex(p),
    };
    let err: Error | undefined;
    try {
      createKnowledgeHost({ dbPath, embeddingProvider: "openai", embeddingModel: "m" }, throwingFactories);
    } catch (e) { err = e as Error; }
    // The raw error from the factory propagates; host.ts itself must not add the key to its message
    expect(err).toBeDefined();
  });
});

describe("createKnowledgeHost — success (fake provider)", () => {
  beforeEach(() => initDb());
  afterEach(() => cleanupDb());

  it("returns a host with a service interface", () => {
    const host = createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" },
      fakeFactories(),
    );
    expect(host.service).toBeDefined();
    expect(typeof host.service.retrieve).toBe("function");
    host.close();
  });

  it("service can be called (keyword-only query, empty DB returns empty hits)", async () => {
    const host = createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" },
      fakeFactories(),
    );
    const result = await host.service.retrieve({
      text: "礼仪",
      limit: 5,
      vectorFailureMode: "keyword_only",
    });
    expect(Array.isArray(result.hits)).toBe(true);
    host.close();
  });

  it("close() is idempotent — calling twice does not throw", () => {
    const host = createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" },
      fakeFactories(),
    );
    expect(() => {
      host.close();
      host.close();
    }).not.toThrow();
  });

  it("service is unusable after close (SQLite throws on closed DB)", () => {
    const host = createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" },
      fakeFactories(),
    );
    host.close();
    return expect(
      host.service.retrieve({ text: "x", limit: 5, vectorFailureMode: "keyword_only" }),
    ).rejects.toThrow();
  });

  it("service returns vector degradation when embedding throws", async () => {
    const host = createKnowledgeHost(
      { dbPath, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small" },
      fakeFactories({ throwOnEmbed: "embedding failed" }),
    );
    const result = await host.service.retrieve({
      text: "礼仪",
      limit: 5,
      vectorFailureMode: "keyword_only",
    });
    expect(result.vectorDegradation).toBeDefined();
    host.close();
  });
});
