import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { KnowledgeChunk } from "../../src/engine/knowledge/model";
import { SqliteKeywordIndex, chineseBigrams, normalizeFtsQuery } from "../../src/engine/knowledge/index/sqlite-fts5";

// ── Bigram and query normalization unit tests ─────────────────────────────────

describe("chineseBigrams", () => {
  it("generates overlapping bigrams from CJK text", () => {
    expect(chineseBigrams("禁足期间")).toBe("禁足 足期 期间");
  });

  it("handles single CJK character", () => {
    expect(chineseBigrams("禁")).toBe("禁");
  });

  it("handles mixed Chinese/non-Chinese", () => {
    const result = chineseBigrams("承养 system");
    expect(result).toContain("承养");
    expect(result).toContain("system");
  });

  it("returns empty string for empty input", () => {
    expect(chineseBigrams("")).toBe("");
  });

  it("handles purely non-Chinese text", () => {
    expect(chineseBigrams("hello world")).toContain("hello");
  });
});

describe("normalizeFtsQuery", () => {
  it("returns null for empty input", () => {
    expect(normalizeFtsQuery("")).toBeNull();
    expect(normalizeFtsQuery("   ")).toBeNull();
  });

  it("decomposes Chinese query into bigrams", () => {
    // 2-char CJK → single bigram = token itself, no OR needed
    expect(normalizeFtsQuery("承养")).toBe("承养");
  });

  it("decomposes 3+ char Chinese into OR-joined bigrams", () => {
    const result = normalizeFtsQuery("禁足期间");
    // Result: "禁足 OR 足期 OR 期间"
    expect(result).toContain("禁足");
    expect(result).toContain("足期");
    expect(result).toContain("期间");
    expect(result).toContain("OR");
  });

  it("strips FTS5 special characters and ASCII punctuation", () => {
    const result = normalizeFtsQuery('test "quoted" -minus (paren)');
    expect(result).not.toContain('"');
    expect(result).not.toContain("-");
    expect(result).not.toContain("(");
    expect(result).not.toBeNull();
  });

  it("strips Unicode/Chinese punctuation — treated as separators", () => {
    // ，。！？ should split, not become tokens
    const result = normalizeFtsQuery("禁足，请安");
    expect(result).not.toContain("，");
    expect(result).toContain("禁足");
    expect(result).toContain("请安");
  });

  it("slash and other delimiters split terms", () => {
    const result = normalizeFtsQuery("宣政殿/紫宸殿");
    expect(result).not.toContain("/");
    expect(result).toContain("宣政");
    expect(result).toContain("紫宸");
  });

  it("AND and OR as plain text do not cause syntax errors", () => {
    // FTS5 boolean keywords are dropped; remaining terms are used
    const result = normalizeFtsQuery("AND OR NOT 内容");
    // "AND", "OR", "NOT" are dropped; "内容" → bigram "内容"
    expect(result).not.toBeNull();
    expect(result).toContain("内容");
    expect(result).not.toMatch(/\bAND\b/);
    expect(result).not.toMatch(/\bOR\b/);
    expect(result).not.toMatch(/\bNOT\b/);
  });

  it("deduplicates tokens", () => {
    expect(normalizeFtsQuery("test test test")).toBe("test");
  });
});

// ── SQLite FTS5 index integration tests ─────────────────────────────────────

let dbPath: string;
let index: SqliteKeywordIndex;

beforeEach(() => {
  dbPath = join(tmpdir(), `knowledge-test-${Date.now()}-${Math.random()}.db`);
  index = new SqliteKeywordIndex(dbPath);
});

afterEach(() => {
  index.close();
  try { rmSync(dbPath); } catch { /* ignore */ }
});

function makeChunk(overrides: Partial<KnowledgeChunk> & { id: string; text: string }): KnowledgeChunk {
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

describe("SqliteKeywordIndex — rebuild and basic search", () => {
  it("can search after rebuild", () => {
    index.rebuild([
      makeChunk({ id: "c1", title: "禁足礼制", text: "受禁足处分的侍君不得离开所居宫殿。" }),
    ]);
    const hits = index.search({ text: "禁足", limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.id).toBe("c1");
  });

  it("repeated rebuild does not produce duplicates", () => {
    const chunk = makeChunk({ id: "c1", title: "测试", text: "禁足期间的请安制度。" });
    index.rebuild([chunk]);
    index.rebuild([chunk]);
    const hits = index.search({ text: "禁足", limit: 100 });
    expect(hits).toHaveLength(1);
  });

  it("after rebuild with fewer chunks, old chunks are gone", () => {
    index.rebuild([
      makeChunk({ id: "c1", title: "禁足", text: "禁足期间不得请安。" }),
      makeChunk({ id: "c2", title: "承养", text: "承养制度的规则。" }),
    ]);
    index.rebuild([makeChunk({ id: "c2", title: "承养", text: "承养制度的规则。" })]);
    const hits = index.search({ text: "禁足", limit: 10 });
    expect(hits).toHaveLength(0);
  });

  it("rebuild is atomic — old chunk IDs are absent after rebuild with new chunks", () => {
    index.rebuild([makeChunk({ id: "first", title: "第一批", text: "龙纹礼制规范" })]);

    // Second rebuild completely replaces the first
    index.rebuild([makeChunk({ id: "second", title: "第二批", text: "凤鸣规则制度" })]);

    // With OR-based retrieval, use the unique 3-char term that only one chunk had
    // "龙纹" bigram only exists in "first" chunk, which was deleted by rebuild
    const fromFirst = index.search({ text: "龙纹", limit: 10 });
    const fromSecond = index.search({ text: "凤鸣", limit: 10 });
    // "first" chunk is gone; its unique bigrams should return no results
    expect(fromFirst.map((h) => h.chunk.id)).not.toContain("first");
    // "second" chunk is present
    expect(fromSecond.map((h) => h.chunk.id)).toContain("second");
  });
});

describe("SqliteKeywordIndex — scoring and ranking", () => {
  it("bm25Score is positive (higher = more relevant)", () => {
    index.rebuild([makeChunk({ id: "c1", title: "禁足", text: "禁足期间不得外出。" })]);
    const hits = index.search({ text: "禁足", limit: 10 });
    expect(hits[0]!.bm25Score).toBeGreaterThan(0);
  });

  it("title match ranks higher than body-only match", () => {
    index.rebuild([
      makeChunk({ id: "title-match", title: "禁足制度", text: "日常礼仪的规范。" }),
      makeChunk({ id: "body-match", title: "日常礼仪", text: "禁足制度详述如下。" }),
    ]);
    const hits = index.search({ text: "禁足", limit: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const titleIdx = hits.findIndex((h) => h.chunk.id === "title-match");
    const bodyIdx = hits.findIndex((h) => h.chunk.id === "body-match");
    expect(titleIdx).toBeLessThan(bodyIdx);
  });

  it("result limit is respected", () => {
    index.rebuild([
      makeChunk({ id: "c1", text: "禁足内容一" }),
      makeChunk({ id: "c2", text: "禁足内容二" }),
      makeChunk({ id: "c3", text: "禁足内容三" }),
    ]);
    const hits = index.search({ text: "禁足", limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("empty query returns empty results", () => {
    index.rebuild([makeChunk({ id: "c1", text: "禁足内容" })]);
    expect(index.search({ text: "", limit: 10 })).toHaveLength(0);
    expect(index.search({ text: "   ", limit: 10 })).toHaveLength(0);
  });

  it("malformed FTS syntax does not throw", () => {
    index.rebuild([makeChunk({ id: "c1", text: "内容" })]);
    expect(() => index.search({ text: "AND OR NOT ***", limit: 10 })).not.toThrow();
    expect(() => index.search({ text: '"""', limit: 10 })).not.toThrow();
  });

  it("tie-break is deterministic (same results on repeated queries)", () => {
    index.rebuild([
      makeChunk({ id: "a", text: "承养制度" }),
      makeChunk({ id: "b", text: "承养制度" }),
    ]);
    const h1 = index.search({ text: "承养", limit: 10 });
    const h2 = index.search({ text: "承养", limit: 10 });
    expect(h1.map((h) => h.chunk.id)).toEqual(h2.map((h) => h.chunk.id));
  });
});

describe("SqliteKeywordIndex — metadata filtering", () => {
  beforeEach(() => {
    index.rebuild([
      makeChunk({ id: "pub", visibility: "public", text: "公开内容" }),
      makeChunk({ id: "rest", visibility: "restricted", text: "公开内容" }),
      makeChunk({ id: "imp", visibility: "imperial", text: "公开内容" }),
      {
        id: "tagged",
        sourceType: "etiquette",
        title: "有标签",
        text: "标签内容",
        tags: ["etiquette", "punishment"],
        entityIds: ["shen_zhibai"],
        locationIds: ["kunninggong"],
        visibility: "public",
        sourcePath: "test.md",
      },
      {
        id: "typed",
        sourceType: "location",
        title: "地点",
        text: "地点内容",
        tags: [],
        entityIds: [],
        locationIds: ["xuanzhengdian"],
        visibility: "public",
        sourcePath: "test.md",
      },
    ]);
  });

  it("public ceiling returns only public chunks", () => {
    const hits = index.search({ text: "公开内容", limit: 10, visibilityCeiling: "public" });
    expect(hits.every((h) => h.chunk.visibility === "public")).toBe(true);
    expect(hits.some((h) => h.chunk.id === "pub")).toBe(true);
    expect(hits.some((h) => h.chunk.id === "rest")).toBe(false);
  });

  it("restricted ceiling returns public + restricted", () => {
    const hits = index.search({ text: "公开内容", limit: 10, visibilityCeiling: "restricted" });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("pub");
    expect(ids).toContain("rest");
    expect(ids).not.toContain("imp");
  });

  it("imperial ceiling returns all", () => {
    const hits = index.search({ text: "公开内容", limit: 10, visibilityCeiling: "imperial" });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("pub");
    expect(ids).toContain("rest");
    expect(ids).toContain("imp");
  });

  it("default visibility ceiling is public (safe default)", () => {
    const hits = index.search({ text: "公开内容", limit: 10 });
    expect(hits.every((h) => h.chunk.visibility === "public")).toBe(true);
  });

  it("sourceType filter restricts results", () => {
    const hits = index.search({
      text: "内容",
      limit: 10,
      sourceTypes: ["location"],
    });
    expect(hits.every((h) => h.chunk.sourceType === "location")).toBe(true);
    expect(hits.some((h) => h.chunk.id === "typed")).toBe(true);
  });

  it("tag filter (any mode) returns chunks with any matching tag", () => {
    const hits = index.search({
      text: "内容",
      limit: 10,
      tagFilter: { values: ["punishment"], mode: "any" },
    });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("tagged");
  });

  it("tag filter (all mode) requires all tags", () => {
    const hits = index.search({
      text: "标签内容",
      limit: 10,
      tagFilter: { values: ["etiquette", "punishment"], mode: "all" },
    });
    expect(hits.some((h) => h.chunk.id === "tagged")).toBe(true);
  });

  it("entityFilter restricts by entity ID", () => {
    const hits = index.search({
      text: "标签内容",
      limit: 10,
      entityFilter: { values: ["shen_zhibai"], mode: "any" },
    });
    expect(hits.some((h) => h.chunk.id === "tagged")).toBe(true);
  });

  it("locationFilter restricts by location ID", () => {
    const hits = index.search({
      text: "内容",
      limit: 10,
      locationFilter: { values: ["xuanzhengdian"], mode: "any" },
    });
    expect(hits.every((h) => h.chunk.locationIds.includes("xuanzhengdian"))).toBe(true);
  });
});

describe("SqliteKeywordIndex — temporal filtering", () => {
  beforeEach(() => {
    index.rebuild([
      // Valid in year 1–3
      {
        id: "year1to3",
        sourceType: "historical_archive",
        title: "早期档案",
        text: "大选档案记录。",
        tags: [],
        entityIds: [],
        locationIds: [],
        validFrom: makeGameTime(1, 1, "early"),
        validUntil: makeGameTime(3, 12, "late"),
        visibility: "public",
        sourcePath: "test.md",
      },
      // No time bounds — always valid
      {
        id: "timeless",
        sourceType: "world_rule",
        title: "永久规则",
        text: "大选档案记录。",
        tags: [],
        entityIds: [],
        locationIds: [],
        visibility: "public",
        sourcePath: "test.md",
      },
      // Valid from year 5 onwards
      {
        id: "future",
        sourceType: "historical_archive",
        title: "未来档案",
        text: "大选档案记录。",
        tags: [],
        entityIds: [],
        locationIds: [],
        validFrom: makeGameTime(5, 1, "early"),
        visibility: "public",
        sourcePath: "test.md",
      },
    ]);
  });

  it("currentTime=year2 returns year1-3 and timeless chunks", () => {
    const hits = index.search({
      text: "大选档案",
      limit: 10,
      currentTime: makeGameTime(2, 6, "mid"),
    });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("year1to3");
    expect(ids).toContain("timeless");
    expect(ids).not.toContain("future");
  });

  it("currentTime=year6 returns future and timeless chunks", () => {
    const hits = index.search({
      text: "大选档案",
      limit: 10,
      currentTime: makeGameTime(6, 1, "early"),
    });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).not.toContain("year1to3");
    expect(ids).toContain("timeless");
    expect(ids).toContain("future");
  });

  it("without currentTime, all chunks are returned (debug mode)", () => {
    const hits = index.search({ text: "大选档案", limit: 10 });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("year1to3");
    expect(ids).toContain("timeless");
    expect(ids).toContain("future");
  });
});

describe("SqliteKeywordIndex — Chinese search", () => {
  beforeEach(() => {
    index.rebuild([
      makeChunk({
        id: "confinement",
        title: "禁足礼制",
        text: "受禁足处分的侍君不得离开所居宫殿，也不参加日常晨省请安。",
      }),
      makeChunk({
        id: "adoption",
        title: "承养制度",
        text: "承养人须有位分，且健康状况良好，不得随意更换承养人。",
      }),
      makeChunk({
        id: "location",
        title: "宣政殿",
        text: "宣政殿是皇帝主持朝会的正殿，金瓦映着白光。",
        locationIds: ["xuanzhengdian"],
        sourcePath: "test.md",
        tags: [],
        entityIds: [],
        visibility: "public",
        sourceType: "location",
      }),
    ]);
  });

  it("searching 承养 finds the adoption chunk", () => {
    const hits = index.search({ text: "承养", limit: 10 });
    expect(hits.some((h) => h.chunk.id === "adoption")).toBe(true);
  });

  it("searching 禁足 请安 preferentially hits confinement chunk", () => {
    const hits = index.search({ text: "禁足 请安", limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.id).toBe("confinement");
  });

  it("searching exact palace name 宣政殿 finds location chunk", () => {
    const hits = index.search({ text: "宣政殿", limit: 10 });
    expect(hits.some((h) => h.chunk.id === "location")).toBe(true);
  });

  it("searching 承养制度 finds adoption chunk", () => {
    const hits = index.search({ text: "承养制度", limit: 10 });
    expect(hits.some((h) => h.chunk.id === "adoption")).toBe(true);
  });
});

describe("SqliteKeywordIndex — SQL injection safety", () => {
  it("SQL-injection-style input does not break the query", () => {
    index.rebuild([makeChunk({ id: "c1", text: "禁足内容" })]);
    expect(() =>
      index.search({ text: "'; DROP TABLE knowledge_chunks; --", limit: 10 }),
    ).not.toThrow();
  });

  it("semicolons in query do not cause multiple statements", () => {
    index.rebuild([makeChunk({ id: "c1", text: "禁足内容" })]);
    expect(() =>
      index.search({ text: "禁足; DELETE FROM knowledge_chunks", limit: 10 }),
    ).not.toThrow();
    // Table still intact
    const after = index.search({ text: "禁足", limit: 10 });
    expect(after.length).toBeGreaterThan(0);
  });
});

describe("SqliteKeywordIndex — natural language queries", () => {
  beforeEach(() => {
    index.rebuild([
      makeChunk({
        id: "confinement",
        title: "禁足礼制",
        text: "受禁足处分的侍君不得离开所居宫殿，也不参加日常晨省请安。禁足令由皇帝亲颁。",
      }),
      makeChunk({
        id: "adoption",
        title: "承养制度",
        text: "承养须满足条件：皇帝亲颁旨；承养人须有位分；承养人本人不得有孕。",
      }),
      makeChunk({
        id: "location",
        title: "宣政殿",
        text: "宣政殿是皇帝主持朝会的正殿。紫宸殿为内廷议事之所。",
        sourceType: "location",
        locationIds: ["xuanzhengdian"],
        tags: [],
        entityIds: [],
        visibility: "public",
        sourcePath: "test.md",
      }),
    ]);
  });

  it("natural language sentence retrieves relevant chunks", () => {
    // Long query: many bigrams; any match earns a result; best-match ranks first
    const hits = index.search({
      text: "皇后向皇帝解释皇后主持晨省的礼制，以及被禁足侍君是否仍需请安",
      limit: 10,
    });
    expect(hits.length).toBeGreaterThan(0);
    // confinement matches "禁足", "请安", "侍君", "皇帝" bigrams
    expect(hits[0]!.chunk.id).toBe("confinement");
  });

  it("Chinese comma in query is treated as separator, not a token", () => {
    const hits = index.search({ text: "禁足，请安", limit: 10 });
    expect(hits.some((h) => h.chunk.id === "confinement")).toBe(true);
  });

  it("slash in query splits into two terms", () => {
    const hits = index.search({ text: "宣政殿/紫宸殿", limit: 10 });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("location");
  });

  it("chunk matching more query terms ranks above chunks matching fewer", () => {
    // all three chunks have some bigrams from "禁足 请安"; confinement has both
    const hits = index.search({ text: "禁足 请安", limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.id).toBe("confinement");
  });

  it("AND and OR as plain text do not cause errors and do not exclude other terms", () => {
    expect(() =>
      index.search({ text: "AND OR 禁足", limit: 10 }),
    ).not.toThrow();
    const hits = index.search({ text: "AND OR 禁足", limit: 10 });
    expect(hits.some((h) => h.chunk.id === "confinement")).toBe(true);
  });
});

describe("SqliteKeywordIndex — BM25 column weight ordering", () => {
  it("title match scores higher than body-only match for same term", () => {
    index.rebuild([
      // "承养" appears ONLY in title (FTS title column, weight 2.0)
      makeChunk({ id: "in-title", title: "承养", text: "此处内容与主题无直接关联。" }),
      // "承养" appears ONLY in text body (FTS body→bigrams column, weight 1.0/0.5)
      makeChunk({ id: "in-body", title: "其他标题", text: "承养制度的详细规定如下所述。" }),
    ]);
    const hits = index.search({ text: "承养", limit: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const titleIdx = hits.findIndex((h) => h.chunk.id === "in-title");
    const bodyIdx = hits.findIndex((h) => h.chunk.id === "in-body");
    expect(titleIdx).toBeLessThan(bodyIdx);
  });
});
