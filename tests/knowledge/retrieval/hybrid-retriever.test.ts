import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "../../../src/engine/knowledge/model";
import { SqliteKeywordIndex } from "../../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex, syncEmbeddings } from "../../../src/engine/knowledge/vector/sqlite-vector-index";
import { KnowledgeHybridRetriever } from "../../../src/engine/knowledge/retrieval/hybrid-retriever";
import { FakeEmbeddingProvider } from "../embedding/fake-provider";
import { compileKnowledgeEmbeddingText } from "../../../src/engine/knowledge/embedding/document-text";

const DIMS = 4;

function makeChunk(overrides: Partial<KnowledgeChunk> & { id: string; text: string; title?: string }): KnowledgeChunk {
  return {
    sourceType: "etiquette",
    title: overrides.title ?? overrides.id,
    tags: [],
    entityIds: [],
    locationIds: [],
    visibility: "public",
    sourcePath: "test.md",
    ...overrides,
  };
}

let dbPath: string;
let kwIndex: SqliteKeywordIndex;
let vecIndex: SqliteVectorIndex;

beforeEach(() => {
  dbPath = join(tmpdir(), `hybrid-test-${Date.now()}-${Math.random()}.db`);
  kwIndex = new SqliteKeywordIndex(dbPath);
  vecIndex = new SqliteVectorIndex(dbPath);
});

afterEach(() => {
  vecIndex.close();
  kwIndex.close();
  try { rmSync(dbPath); } catch { /* ignore */ }
  try { rmSync(dbPath + "-shm"); } catch { /* ignore */ }
  try { rmSync(dbPath + "-wal"); } catch { /* ignore */ }
});

/** Seed keyword + vector indexes with orthogonal vectors, one per chunk. */
async function seedCorpus(chunks: KnowledgeChunk[], provider: FakeEmbeddingProvider) {
  kwIndex.rebuild(chunks);
  await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex });
}

/** A provider whose embed() throws. */
function throwingProvider(msg = "provider down"): FakeEmbeddingProvider {
  return new FakeEmbeddingProvider({ throwOnEmbed: msg, dimensions: DIMS });
}

// ── Basic retrieval ───────────────────────────────────────────────────────────

describe("KnowledgeHybridRetriever.retrieve — basics", () => {
  it("returns empty hits for empty corpus", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    // No embeddings — provider still responds; model has no entries → keyword_only degrades
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    const result = await retriever.retrieve({ text: "test", limit: 5, vectorFailureMode: "keyword_only" });
    expect(result.hits).toHaveLength(0);
  });

  it("returns hits with required fields", async () => {
    const chunk = makeChunk({ id: "c1", text: "宫廷礼仪", title: "礼仪规范" });
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    // Pin vectors so retriever can search them
    provider.defineVector("Represent this query for retrieval: 礼仪", [1, 0, 0, 0]);
    await seedCorpus([chunk], provider);

    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    const result = await retriever.retrieve({ text: "礼仪", limit: 5, visibilityCeiling: "imperial" });
    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits[0]!;
    expect(hit.chunk.id).toBe("c1");
    expect(typeof hit.hybridScore).toBe("number");
    expect(hit.rank).toBe(1);
  });

  it("respects the limit", async () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({ id: `c${i}`, text: `content ${i}`, title: `title${i}` }),
    );
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus(chunks, provider);
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    const result = await retriever.retrieve({ text: "content", limit: 2, visibilityCeiling: "imperial" });
    expect(result.hits.length).toBeLessThanOrEqual(2);
  });

  it("fused rank matches position in result array (1-based)", async () => {
    const chunks = [makeChunk({ id: "a", text: "alpha text", title: "alpha" }),
                    makeChunk({ id: "b", text: "beta content", title: "beta" })];
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus(chunks, provider);
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    const result = await retriever.retrieve({ text: "alpha", limit: 5, visibilityCeiling: "imperial" });
    result.hits.forEach((h, i) => expect(h.rank).toBe(i + 1));
  });

  it("no vectorDegradation on success", async () => {
    const chunk = makeChunk({ id: "c1", text: "text", title: "T" });
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus([chunk], provider);
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    const result = await retriever.retrieve({ text: "text", limit: 5, visibilityCeiling: "imperial" });
    expect(result.vectorDegradation).toBeUndefined();
  });
});

// ── Vector failure modes — provider errors ────────────────────────────────────

describe("vectorFailureMode — provider rejects", () => {
  it("keyword_only: returns keyword hits and degradation record when provider throws", async () => {
    const chunk = makeChunk({ id: "kw_chunk", text: "禁足礼仪规范", title: "禁足" });
    kwIndex.rebuild([chunk]);
    // No vector embeddings; use a provider that throws
    const provider = throwingProvider("network error");
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);

    const result = await retriever.retrieve({
      text: "禁足礼仪",
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });

    // Keyword hit must be present and identified exactly
    expect(result.hits.some((h) => h.chunk.id === "kw_chunk")).toBe(true);
    const hit = result.hits.find((h) => h.chunk.id === "kw_chunk")!;
    expect(hit.keywordRank).not.toBeNull();
    expect(hit.vectorRank).toBeNull();
    expect(hit.cosineScore).toBeNull();

    // Degradation record must be present with the right reason
    expect(result.vectorDegradation).toBeDefined();
    expect(result.vectorDegradation!.reason).toBe("provider_error");
    expect(result.vectorDegradation!.message).toContain("network error");
  });

  it("fail: propagates provider error", async () => {
    const chunk = makeChunk({ id: "c1", text: "text", title: "T" });
    kwIndex.rebuild([chunk]);
    const provider = throwingProvider("API auth failure");
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);

    await expect(
      retriever.retrieve({ text: "text", limit: 5, vectorFailureMode: "fail", visibilityCeiling: "imperial" }),
    ).rejects.toThrow("API auth failure");
  });
});

// ── Vector failure modes — missing model ─────────────────────────────────────

describe("vectorFailureMode — missing modelKey (no embeddings indexed)", () => {
  it("keyword_only: degrades gracefully with no_embeddings reason", async () => {
    const chunk = makeChunk({ id: "kw2", text: "请安礼仪制度", title: "请安" });
    kwIndex.rebuild([chunk]);
    // Provider has a different modelKey — nothing seeded in vecIndex for it
    const provider = new FakeEmbeddingProvider({
      providerId: "openai",
      model: "nonexistent-model",
      dimensions: DIMS,
    });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);

    const result = await retriever.retrieve({
      text: "请安",
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });

    // Keyword hits are returned
    expect(result.hits.some((h) => h.chunk.id === "kw2")).toBe(true);
    // Degradation has the right reason
    expect(result.vectorDegradation).toBeDefined();
    expect(result.vectorDegradation!.reason).toBe("no_embeddings");
  });

  it("fail: throws on missing modelKey", async () => {
    const chunk = makeChunk({ id: "c1", text: "text", title: "T" });
    kwIndex.rebuild([chunk]);
    const provider = new FakeEmbeddingProvider({ model: "not-indexed", dimensions: DIMS });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);

    await expect(
      retriever.retrieve({ text: "text", limit: 5, vectorFailureMode: "fail", visibilityCeiling: "imperial" }),
    ).rejects.toThrow(/no embeddings found/i);
  });
});

// ── Vector failure modes — invalid embedding ──────────────────────────────────

describe("vectorFailureMode — invalid query embedding", () => {
  it("fail: throws EmbeddingValidationError on wrong-dimension query result", async () => {
    const chunk = makeChunk({ id: "c1", text: "text", title: "T" });
    // Seed with 4-dim provider
    const seedProvider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus([chunk], seedProvider);

    // Query provider returns 2-dim vectors — will fail the search's dimension check
    const queryProvider = new FakeEmbeddingProvider({
      providerId: seedProvider.providerId,
      model: seedProvider.model,
      dimensions: 2, // wrong dimension
    });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, queryProvider);

    await expect(
      retriever.retrieve({ text: "text", limit: 5, vectorFailureMode: "fail", visibilityCeiling: "imperial" }),
    ).rejects.toThrow();
  });

  it("keyword_only: degrades on wrong-dimension query result", async () => {
    const chunk = makeChunk({ id: "c1", text: "some text", title: "T" });
    const seedProvider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus([chunk], seedProvider);

    const queryProvider = new FakeEmbeddingProvider({
      providerId: seedProvider.providerId,
      model: seedProvider.model,
      dimensions: 2,
    });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, queryProvider);

    const result = await retriever.retrieve({
      text: "some text",
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });
    expect(result.vectorDegradation).toBeDefined();
    expect(result.hits.some((h) => h.chunk.id === "c1")).toBe(true);
  });
});

// ── Fusion correctness ────────────────────────────────────────────────────────

describe("hybrid score — fusion semantics", () => {
  it("chunk appearing in both channels scores higher than keyword-only chunk", async () => {
    // Both chunks match the keyword query (share "礼仪" bigram with query "宫廷礼仪").
    // Only cBoth is seeded with a vector embedding.
    // Therefore: cBoth appears in keyword + vector; cKwOnly appears in keyword only.
    const queryText = "宫廷礼仪";
    const cBoth = makeChunk({ id: "both", text: "宫廷礼仪规范详解", title: "礼仪规范" });
    const cKwOnly = makeChunk({ id: "kw_only", text: "宫廷礼仪制度条例", title: "礼仪制度" });

    // Pin cBoth's stored document embedding to [1,0,0,0].
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    const cBothEmbedText = compileKnowledgeEmbeddingText(cBoth);
    provider.defineVector(cBothEmbedText, [1, 0, 0, 0]);

    // Keyword: both chunks; Vector: only cBoth
    kwIndex.rebuild([cBoth, cKwOnly]);
    await syncEmbeddings({ chunks: [cBoth], provider, vectorIndex: vecIndex });

    // Query vector [1,0,0,0] → perfect cosine match for cBoth's stored [1,0,0,0]
    provider.defineVector(queryText, [1, 0, 0, 0]);
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);

    const result = await retriever.retrieve({
      text: queryText,
      limit: 5,
      visibilityCeiling: "imperial",
    });

    const bothHit = result.hits.find((h) => h.chunk.id === "both");
    const kwOnlyHit = result.hits.find((h) => h.chunk.id === "kw_only");

    // Both chunks must appear — they both match the keyword query
    expect(bothHit).toBeDefined();
    expect(kwOnlyHit).toBeDefined();
    // "both" appears in vector results; "kw_only" does not (no embedding seeded)
    expect(bothHit!.vectorRank).not.toBeNull();
    expect(kwOnlyHit!.vectorRank).toBeNull();
    // "both" should have higher hybrid score and earlier rank
    expect(bothHit!.hybridScore).toBeGreaterThan(kwOnlyHit!.hybridScore);
    expect(bothHit!.rank).toBeLessThan(kwOnlyHit!.rank);
  });
});

// ── RRF parameter validation ──────────────────────────────────────────────────

describe("RRF parameter validation", () => {
  it("throws on negative rrfK", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    await expect(
      retriever.retrieve({ text: "x", limit: 1, rrfK: -1 }),
    ).rejects.toThrow(/rrfK/i);
  });

  it("throws on both weights = 0", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    await expect(
      retriever.retrieve({ text: "x", limit: 1, keywordWeight: 0, vectorWeight: 0 }),
    ).rejects.toThrow(/weight/i);
  });

  it("throws on non-integer limit", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    await expect(
      retriever.retrieve({ text: "x", limit: 0 }),
    ).rejects.toThrow(/limit/i);
  });

  it("accepts custom valid RRF params", async () => {
    const chunk = makeChunk({ id: "c1", text: "content", title: "T" });
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus([chunk], provider);
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);
    await expect(
      retriever.retrieve({
        text: "content",
        limit: 5,
        visibilityCeiling: "imperial",
        rrfK: 10,
        keywordWeight: 0.5,
        vectorWeight: 1.5,
      }),
    ).resolves.toBeDefined();
  });
});

// ── Degradation diagnostic completeness ──────────────────────────────────────

describe("VectorDegradation — field completeness", () => {
  it("degradation has both reason and message fields", async () => {
    kwIndex.rebuild([makeChunk({ id: "c1", text: "礼仪", title: "T" })]);
    const provider = throwingProvider("something went wrong");
    const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, provider);

    const result = await retriever.retrieve({
      text: "礼仪",
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });
    expect(result.vectorDegradation).toBeDefined();
    expect(typeof result.vectorDegradation!.reason).toBe("string");
    expect(typeof result.vectorDegradation!.message).toBe("string");
    expect(result.vectorDegradation!.message).toContain("something went wrong");
  });
});
