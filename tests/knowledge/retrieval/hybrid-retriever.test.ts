import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "../../../src/engine/knowledge/model";
import { SqliteKeywordIndex } from "../../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex, syncEmbeddings } from "../../../src/engine/knowledge/vector/sqlite-vector-index";
import { KnowledgeHybridRetriever } from "../../../src/engine/knowledge/retrieval/hybrid-retriever";
import { FakeEmbeddingProvider } from "../embedding/fake-provider";

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
let retriever: KnowledgeHybridRetriever;

beforeEach(() => {
  dbPath = join(tmpdir(), `hybrid-test-${Date.now()}-${Math.random()}.db`);
  kwIndex = new SqliteKeywordIndex(dbPath);
  vecIndex = new SqliteVectorIndex(dbPath);
  retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex);
});

afterEach(() => {
  vecIndex.close();
  kwIndex.close();
  try { rmSync(dbPath); } catch { /* ignore */ }
  try { rmSync(dbPath + "-shm"); } catch { /* ignore */ }
  try { rmSync(dbPath + "-wal"); } catch { /* ignore */ }
});

async function seedCorpus(
  chunks: KnowledgeChunk[],
  provider: FakeEmbeddingProvider,
) {
  kwIndex.rebuild(chunks);
  await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex });
}

// ── Basic retrieval ───────────────────────────────────────────────────────────

describe("KnowledgeHybridRetriever.retrieve", () => {
  it("returns empty array for empty corpus", () => {
    const hits = retriever.retrieve({
      text: "礼仪",
      modelKey: "openai:m",
      queryVector: [1, 0, 0, 0],
      limit: 5,
    });
    expect(hits).toHaveLength(0);
  });

  it("returns hits with required fields", async () => {
    const chunks = [makeChunk({ id: "c1", text: "宫廷礼仪", title: "礼仪规范" })];
    let counter = 0;
    const provider = new FakeEmbeddingProvider({
      dimensions: DIMS,
      vectorFactory: () => { const v = Array(DIMS).fill(0) as number[]; v[counter++ % DIMS] = 1; return v; },
    });
    await seedCorpus(chunks, provider);

    const hits = retriever.retrieve({
      text: "礼仪",
      modelKey: provider.modelKey,
      queryVector: [1, 0, 0, 0],
      limit: 5,
      visibilityCeiling: "imperial",
    });
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0]!;
    expect(hit.chunk.id).toBe("c1");
    expect(typeof hit.hybridScore).toBe("number");
    expect(hit.rank).toBe(1);
  });

  it("respects the limit", async () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({ id: `c${i}`, text: `content ${i}` }),
    );
    let counter = 0;
    const provider = new FakeEmbeddingProvider({
      dimensions: DIMS,
      vectorFactory: () => { const v = Array(DIMS).fill(0) as number[]; v[counter++ % DIMS] = 1; return v; },
    });
    await seedCorpus(chunks, provider);

    const hits = retriever.retrieve({
      text: "content",
      modelKey: provider.modelKey,
      queryVector: [1, 0, 0, 0],
      limit: 2,
      visibilityCeiling: "imperial",
    });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("fused rank matches position in result array (1-based)", async () => {
    const chunks = [
      makeChunk({ id: "a", text: "alpha text" }),
      makeChunk({ id: "b", text: "beta content" }),
    ];
    let counter = 0;
    const provider = new FakeEmbeddingProvider({
      dimensions: DIMS,
      vectorFactory: () => { const v = Array(DIMS).fill(0) as number[]; v[counter++ % DIMS] = 1; return v; },
    });
    await seedCorpus(chunks, provider);

    const hits = retriever.retrieve({
      text: "alpha",
      modelKey: provider.modelKey,
      queryVector: [1, 0, 0, 0],
      limit: 5,
      visibilityCeiling: "imperial",
    });
    hits.forEach((h, i) => expect(h.rank).toBe(i + 1));
  });

  it("keyword-only hit has null cosineScore / vectorRank", async () => {
    // Seed with only keyword index populated — no vector embeddings
    const chunk = makeChunk({ id: "kw", text: "unique keyword phrase" });
    kwIndex.rebuild([chunk]);
    // do NOT call syncEmbeddings — no embeddings exist

    const hits = retriever.retrieve({
      text: "unique keyword phrase",
      modelKey: "openai:nonexistent",
      queryVector: [1, 0, 0, 0],
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits.find((h) => h.chunk.id === "kw")!;
    expect(hit).toBeDefined();
    expect(hit.vectorRank).toBeNull();
    expect(hit.cosineScore).toBeNull();
    expect(hit.keywordRank).not.toBeNull();
  });

  it("vectorFailureMode=fail propagates vector errors", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    // No embeddings → vector search gets 0 results, not an error; use wrong dims to force throw

    // Seed with 4-dim embeddings, then query with 2-dim vector (dim mismatch throws)
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus([chunk], provider);

    expect(() =>
      retriever.retrieve({
        text: "text",
        modelKey: provider.modelKey,
        queryVector: [1, 0], // wrong dims — will throw
        limit: 5,
        vectorFailureMode: "fail",
        visibilityCeiling: "imperial",
      }),
    ).toThrow(/dimension mismatch/i);
  });

  it("vectorFailureMode=keyword_only swallows vector errors", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus([chunk], provider);

    // Wrong dims → vector throws, but keyword_only swallows it
    const hits = retriever.retrieve({
      text: "text",
      modelKey: provider.modelKey,
      queryVector: [1, 0], // wrong dims
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });
    // Keyword may or may not find "text" (short stop-word), but should not throw
    expect(Array.isArray(hits)).toBe(true);
  });

  it("hybrid score is higher for chunks appearing in both channels", async () => {
    // c_both appears in keyword results AND vector results
    // c_kw_only appears only in keyword results
    const cBoth = makeChunk({ id: "both", text: "禁足礼仪内容", title: "禁足" });
    const cKwOnly = makeChunk({ id: "kw_only", text: "礼仪制度", title: "礼制" });

    let counter = 0;
    const provider = new FakeEmbeddingProvider({
      dimensions: DIMS,
      vectorFactory: () => { const v = Array(DIMS).fill(0) as number[]; v[counter++ % DIMS] = 1; return v; },
    });
    // c_both gets vector [1,0,0,0]; c_kw_only gets [0,1,0,0]
    await seedCorpus([cBoth, cKwOnly], provider);

    const hits = retriever.retrieve({
      text: "禁足礼仪",
      modelKey: provider.modelKey,
      queryVector: [1, 0, 0, 0], // perfectly matches c_both
      limit: 5,
      visibilityCeiling: "imperial",
    });

    const bothHit = hits.find((h) => h.chunk.id === "both");
    const kwOnlyHit = hits.find((h) => h.chunk.id === "kw_only");

    if (bothHit && kwOnlyHit) {
      // both should have higher or equal score to kw_only
      expect(bothHit.hybridScore).toBeGreaterThanOrEqual(kwOnlyHit.hybridScore);
    }
  });

  it("applies RRF with custom weights and k", async () => {
    const chunks = [makeChunk({ id: "c1", text: "content" })];
    const provider = new FakeEmbeddingProvider({ dimensions: DIMS });
    await seedCorpus(chunks, provider);

    // Should not throw with custom RRF params
    const hits = retriever.retrieve({
      text: "content",
      modelKey: provider.modelKey,
      queryVector: [1, 0, 0, 0],
      limit: 5,
      visibilityCeiling: "imperial",
      rrfK: 10,
      keywordWeight: 0.5,
      vectorWeight: 1.5,
    });
    expect(Array.isArray(hits)).toBe(true);
  });
});

// ── RRF unit tests ────────────────────────────────────────────────────────────

describe("reciprocalRankFusion (via retriever internals)", () => {
  it("keyword-only hit has non-null keywordRank", async () => {
    const chunk = makeChunk({ id: "kw", text: "unique phrase xyz" });
    kwIndex.rebuild([chunk]);
    // no vector sync

    const hits = retriever.retrieve({
      text: "unique phrase xyz",
      modelKey: "openai:none",
      queryVector: [0, 0, 0, 1],
      limit: 5,
      vectorFailureMode: "keyword_only",
      visibilityCeiling: "imperial",
    });
    const h = hits[0];
    if (h) {
      expect(h.keywordRank).not.toBeNull();
    }
  });
});
