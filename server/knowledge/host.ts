/**
 * Node-only knowledge composition root.
 *
 * Creates and wires the full retrieval stack from environment config:
 *   SqliteKeywordIndex + SqliteVectorIndex + EmbeddingProvider
 *   → KnowledgeHybridRetriever → KnowledgeRetrievalService
 *
 * Security constraints:
 *   - Reads API keys from environment only; never accepts them as params
 *   - Does NOT log API keys, DB paths, or raw exception messages
 *   - DB path is never returned to the browser
 *   - Fails fast on missing config rather than proceeding silently
 *   - close() is idempotent
 *   - On init failure, already-opened resources are closed before rethrowing
 */
import { existsSync } from "node:fs";
import { SqliteKeywordIndex } from "../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex } from "../../src/engine/knowledge/vector/sqlite-vector-index";
import { KnowledgeHybridRetriever } from "../../src/engine/knowledge/retrieval/hybrid-retriever";
import { createEmbeddingProvider } from "../../src/engine/knowledge/embedding/provider-factory";
import type { KnowledgeRetrievalService } from "./handler";

export interface KnowledgeHostConfig {
  /** Absolute path to .knowledge.db. Read from KNOWLEDGE_DB_PATH. */
  readonly dbPath: string;
  /** Embedding provider identifier. Read from KNOWLEDGE_EMBEDDING_PROVIDER. */
  readonly embeddingProvider: "openai" | "gemini";
  /** Model name for the embedding provider. Read from KNOWLEDGE_EMBEDDING_MODEL. */
  readonly embeddingModel: string;
}

export interface KnowledgeHost {
  readonly service: KnowledgeRetrievalService;
  /** Idempotent — safe to call multiple times. */
  close(): void;
}

/**
 * Parse and validate environment config for the knowledge host.
 * Throws a descriptive error if required vars are missing.
 * Never logs the values of API keys or full paths.
 */
export function parseKnowledgeHostConfig(): KnowledgeHostConfig {
  const dbPath = process.env["KNOWLEDGE_DB_PATH"];
  if (!dbPath) throw new Error("[knowledge-host] KNOWLEDGE_DB_PATH is not set");

  const rawProvider = process.env["KNOWLEDGE_EMBEDDING_PROVIDER"];
  if (!rawProvider) throw new Error("[knowledge-host] KNOWLEDGE_EMBEDDING_PROVIDER is not set");
  if (rawProvider !== "openai" && rawProvider !== "gemini") {
    throw new Error(`[knowledge-host] KNOWLEDGE_EMBEDDING_PROVIDER must be "openai" or "gemini", got an unsupported value`);
  }

  const embeddingModel = process.env["KNOWLEDGE_EMBEDDING_MODEL"];
  if (!embeddingModel) throw new Error("[knowledge-host] KNOWLEDGE_EMBEDDING_MODEL is not set");

  return { dbPath, embeddingProvider: rawProvider, embeddingModel };
}

/**
 * Create a KnowledgeHost from explicit config.
 *
 * On failure: any already-opened indexes are closed before the error propagates.
 */
export function createKnowledgeHost(config: KnowledgeHostConfig): KnowledgeHost {
  // Fail fast if DB file is absent — otherwise SQLite would silently create an empty DB.
  if (!existsSync(config.dbPath)) {
    throw new Error(`[knowledge-host] DB file not found`);
  }

  let keywordIndex: SqliteKeywordIndex | undefined;
  let vectorIndex: SqliteVectorIndex | undefined;

  try {
    // createEmbeddingProvider reads API key from env; throws if absent — before
    // we open any SQLite handles, so no cleanup needed at that point.
    const embeddingProvider = createEmbeddingProvider({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
    });

    keywordIndex = new SqliteKeywordIndex(config.dbPath);
    vectorIndex = new SqliteVectorIndex(config.dbPath);

    const retriever = new KnowledgeHybridRetriever(keywordIndex, vectorIndex, embeddingProvider);

    let closed = false;

    return {
      service: retriever,
      close() {
        if (closed) return;
        closed = true;
        try { vectorIndex?.close(); } catch { /* best-effort */ }
        try { keywordIndex?.close(); } catch { /* best-effort */ }
      },
    };
  } catch (err) {
    // Partial init: close whatever was opened before rethrowing
    try { vectorIndex?.close(); } catch { /* best-effort */ }
    try { keywordIndex?.close(); } catch { /* best-effort */ }
    throw err;
  }
}
