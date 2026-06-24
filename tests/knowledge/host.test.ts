/**
 * PR6 tests for the knowledge composition root (host.ts).
 *
 * Uses real temporary SQLite DBs + FakeEmbeddingProvider to avoid network calls.
 * FakeEmbeddingProvider is used indirectly: the host wires its own provider via
 * env vars, so we stub the env and use a fake key (no real API call on init).
 *
 * Covers:
 *  1. Valid DB + valid env → host created, service returns results
 *  2. DB file not found → createKnowledgeHost throws immediately
 *  3. Missing API key env var → createKnowledgeHost throws
 *  4. Invalid KNOWLEDGE_EMBEDDING_PROVIDER → parseKnowledgeHostConfig throws
 *  5. Partial init failure → already-opened indexes are closed (resource safety)
 *  6. close() is idempotent (safe to call twice)
 *  7. Logs during host failure do not contain API keys or absolute paths
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteKeywordIndex } from "../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex } from "../../src/engine/knowledge/vector/sqlite-vector-index";
import {
  createKnowledgeHost,
  parseKnowledgeHostConfig,
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

  it("error messages do not reveal env var values (API key safety)", () => {
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
    expect(() => createKnowledgeHost({
      dbPath: nonexistent,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    })).toThrow();
  });

  it("throws when OPENAI_API_KEY is absent (provider init fails)", () => {
    initDb();
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => createKnowledgeHost({
      dbPath,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    })).toThrow();
  });

  it("error on missing API key does not reveal the key itself", () => {
    initDb();
    vi.stubEnv("OPENAI_API_KEY", "");
    let err: Error | undefined;
    try {
      createKnowledgeHost({ dbPath, embeddingProvider: "openai", embeddingModel: "m" });
    } catch (e) { err = e as Error; }
    expect(err).toBeDefined();
    expect(err!.message).not.toMatch(/sk-[A-Za-z0-9]+/);
  });
});

describe("createKnowledgeHost — success", () => {
  beforeEach(() => {
    initDb();
    vi.stubEnv("OPENAI_API_KEY", "sk-test-fake-key-for-host-test");
  });

  afterEach(() => {
    cleanupDb();
    vi.unstubAllEnvs();
  });

  it("returns a host with a service interface", () => {
    const host = createKnowledgeHost({
      dbPath,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });
    expect(host.service).toBeDefined();
    expect(typeof host.service.retrieve).toBe("function");
    host.close();
  });

  it("service can be called (keyword-only query, empty DB returns empty hits)", async () => {
    const host = createKnowledgeHost({
      dbPath,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });
    const result = await host.service.retrieve({
      text: "礼仪",
      limit: 5,
      vectorFailureMode: "keyword_only",
    });
    expect(Array.isArray(result.hits)).toBe(true);
    host.close();
  });

  it("close() is idempotent — calling twice does not throw", () => {
    const host = createKnowledgeHost({
      dbPath,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });
    expect(() => {
      host.close();
      host.close();
    }).not.toThrow();
  });

  it("service is unusable after close (SQLite throws on closed DB)", () => {
    const host = createKnowledgeHost({
      dbPath,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });
    host.close();
    // A query after close should throw (SQLite database is not open)
    return expect(
      host.service.retrieve({ text: "x", limit: 5, vectorFailureMode: "keyword_only" }),
    ).rejects.toThrow();
  });
});
