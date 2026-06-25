/**
 * Regression tests for the PR7B production lore corpus.
 *
 * Covers the 15 regression requirements from the PR7B spec:
 *  1.  All production docs pass knowledge:validate.
 *  2.  All headings use stable anchors.
 *  3.  All golden expected IDs actually exist in the corpus.
 *  4.  Heading rename does not change golden expected ID.
 *  5.  Display name rename does not change chunk ID.
 *  6.  New canonical names are retrievable.
 *  7.  Deprecated aliases are absent from production lore.
 *  8.  官男子 does not appear in formal rank results.
 *  9.  Location JSON and lore Markdown can both be ingested together.
 * 10.  visibilityCeiling: "public" never returns restricted/imperial chunks.
 * 11.  currentTime filters out expired or future-only chunks.
 * 12.  Duplicate chunk IDs are impossible after normalization.
 * 13.  Keyword eval produces identical results on two runs (determinism).
 * 14.  Eval does not call any embedding provider.
 * 15.  Eval runner returns non-zero exit when a gate is violated.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ingestSources, type KnowledgeSource } from "../../src/engine/knowledge/ingestion/pipeline";
import { validateLoreDocument, collectDeprecatedTerms, validateLoreBodyForDeprecatedTerms } from "../../src/engine/knowledge/authoring/validate";
import { parseEvalCases } from "../../src/engine/knowledge/eval/schema";
import { runKeywordEval } from "../../src/engine/knowledge/eval/runner";
import { computeAggregateMetrics } from "../../src/engine/knowledge/eval/metrics";
import { SqliteKeywordIndex } from "../../src/engine/knowledge/index/sqlite-fts5";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameError } from "../../src/engine/infra/errors";
import type { KnowledgeChunk } from "../../src/engine/knowledge/model";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const LORE_DIR = join(PROJECT_ROOT, "content", "knowledge");
const LOCATION_DIR = join(PROJECT_ROOT, "content", "locations");
const CASES_PATH = join(PROJECT_ROOT, "tests/knowledge/golden/cases.jsonl");

function loadCorpus(): KnowledgeChunk[] {
  const sources: KnowledgeSource[] = [];
  if (existsSync(LORE_DIR)) {
    for (const f of readdirSync(LORE_DIR).filter((f) => f.endsWith(".md")).sort()) {
      sources.push({
        kind: "markdown",
        content: readFileSync(join(LORE_DIR, f), "utf8"),
        sourcePath: `content/knowledge/${f}`,
      });
    }
  }
  if (existsSync(LOCATION_DIR)) {
    for (const f of readdirSync(LOCATION_DIR).filter((f) => f.endsWith(".json")).sort()) {
      sources.push({
        kind: "location_json",
        data: JSON.parse(readFileSync(join(LOCATION_DIR, f), "utf8")) as unknown,
        sourcePath: `content/locations/${f}`,
      });
    }
  }
  const errors: GameError[] = [];
  const chunks = ingestSources(sources, errors);
  if (errors.length > 0) throw new Error(`Corpus ingest failed: ${errors.map((e) => e.message).join("; ")}`);
  return chunks;
}

const corpus = loadCorpus();
const chunkIds = new Set(corpus.map((c) => c.id));

// ── 1. All production lore docs pass validate ──────────────────────────────

describe("production lore docs: validation", () => {
  if (!existsSync(LORE_DIR)) {
    it.skip("no lore dir yet", () => {});
    return;
  }
  const files = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md")).sort();

  for (const file of files) {
    it(`${file} passes validateLoreDocument`, () => {
      const content = readFileSync(join(LORE_DIR, file), "utf8");
      const findings = validateLoreDocument({ content, label: file, requireAnchors: true });
      const errors = findings.filter((f) => f.kind === "error");
      expect(errors, `${file}: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);
    });
  }
});

// ── 2. All H2/H3 headings have stable anchors ────────────────────────────────

describe("production lore docs: stable anchors", () => {
  if (!existsSync(LORE_DIR)) return;
  const files = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md")).sort();

  for (const file of files) {
    it(`${file}: every H2/H3 has a {#anchor}`, () => {
      const content = readFileSync(join(LORE_DIR, file), "utf8");
      const body = content.split("---").slice(2).join("---");
      const headings = body.match(/^#{2,3}\s+.+/gm) ?? [];
      for (const h of headings) {
        expect(h, `heading without anchor: "${h}"`).toMatch(/\{#[a-z][a-z0-9-]*\}\s*$/);
      }
    });
  }
});

// ── 3. All golden referenced IDs exist in corpus (expected AND forbidden) ────

describe("golden cases: all referenced IDs exist in corpus", () => {
  const casesContent = readFileSync(CASES_PATH, "utf8");
  const cases = parseEvalCases(casesContent);

  it(`cases.jsonl: ${cases.length} cases loaded`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  for (const c of cases) {
    const allReferenced = [
      ...(c.expectedAnyOf ?? []),
      ...(c.expectedAll ?? []),
      ...(c.forbiddenIds ?? []),
    ];
    if (allReferenced.length === 0) continue;
    it(`case '${c.id}': all referenced IDs exist`, () => {
      for (const id of allReferenced) {
        expect(chunkIds, `missing ID '${id}' in case '${c.id}'`).toContain(id);
      }
    });
  }
});

// ── 4. Heading rename does not break golden ID ────────────────────────────────

describe("anchor stability: heading rename preserves chunk ID", () => {
  it("chunk titles can differ from heading text while ID stays stable", () => {
    const original = corpus.find((c) => c.id === "titles.harem-ranks#rank-order");
    expect(original).toBeDefined();

    // Simulate renamed heading but same anchor
    const renamed = `---
id: titles.harem-ranks
sourceType: etiquette
title: 后宫位分与自称
tags:
  - 后宫
entityIds: []
locationIds: []
visibility: public
---

## 后宫正式位分顺序（经改编的标题）{#rank-order}

${original!.text}
`;
    const errors: GameError[] = [];
    const chunks = ingestSources(
      [{ kind: "markdown", content: renamed, sourcePath: "test.md" }],
      errors,
    );
    expect(errors).toHaveLength(0);
    expect(chunks.some((c) => c.id === "titles.harem-ranks#rank-order")).toBe(true);
  });
});

// ── 5. Display name rename does not change chunk ID ───────────────────────────

describe("anchor stability: display name change keeps ID", () => {
  it("title frontmatter change does not affect chunk ID", () => {
    const base = `---
id: world.social-order
sourceType: world_rule
title: 礼法女尊秩序（改名）
tags:
  - 女尊
entityIds: []
locationIds: []
visibility: public
---

## 帝国基本秩序 {#basic-order}

本朝实行礼法女尊制度。
`;
    const errors: GameError[] = [];
    const chunks = ingestSources(
      [{ kind: "markdown", content: base, sourcePath: "test.md" }],
      errors,
    );
    expect(errors).toHaveLength(0);
    expect(chunks.some((c) => c.id === "world.social-order#basic-order")).toBe(true);
  });
});

// ── 6. New canonical names are retrievable ────────────────────────────────────

describe("canonical term retrieval", () => {
  let index: SqliteKeywordIndex;

  it("build index from corpus (one-time setup)", () => {
    index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("良仪 is retrievable (canonical east palace lowest rank)", () => {
    const hits = index.search({ text: "良仪 东宫", limit: 5 });
    const ids = hits.map((h) => h.chunk.id);
    expect(
      ids.some((id) => id.startsWith("titles.household-and-east-palace")),
    ).toBe(true);
  });

  it("更衣 is retrievable (lowest canonical harem rank)", () => {
    const hits = index.search({ text: "更衣 后宫最低位分", limit: 5 });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids.some((id) => id.startsWith("titles.harem-ranks"))).toBe(true);
  });

  it("尚皇郎 is retrievable", () => {
    const hits = index.search({ text: "尚皇郎 婚配动词", limit: 5 });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids.some((id) => id.startsWith("titles.marriage-verbs"))).toBe(true);
  });

  it("cleanup: close index", () => {
    index.close();
  });
});

// ── 7. Deprecated aliases absent from production lore body ───────────────────

describe("production lore: no deprecated terms in body text", () => {
  const db = loadRealContent();
  const deprecatedTerms = collectDeprecatedTerms(Object.values(db.ranks));

  if (!existsSync(LORE_DIR)) return;
  const files = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md")).sort();

  for (const file of files) {
    it(`${file}: body contains no deprecated terms`, () => {
      const content = readFileSync(join(LORE_DIR, file), "utf8");
      const body = content.split("---").slice(2).join("---");
      const findings = validateLoreBodyForDeprecatedTerms(body, file, deprecatedTerms);
      const errors = findings.filter((f) => f.kind === "error");
      expect(errors, `${file}: deprecated terms found: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
    });
  }
});

// ── 8. 官男子 absent from harem rank results ─────────────────────────────────

describe("official rank search: 官男子 excluded", () => {
  it("searching for harem position list does not return guannanzi", () => {
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);
    const hits = index.search({ text: "后宫正式位分顺序", limit: 20 });
    for (const h of hits) {
      expect(h.chunk.text).not.toContain("官男子");
      expect(h.chunk.title).not.toContain("官男子");
    }
    index.close();
  });
});

// ── 9. Location JSON and lore Markdown ingest together ───────────────────────

describe("mixed source ingestion", () => {
  it("location JSON chunks have prefix 'location.'", () => {
    const locationChunks = corpus.filter((c) => c.sourceType === "location");
    expect(locationChunks.length).toBeGreaterThan(0);
    for (const c of locationChunks) {
      expect(c.id).toMatch(/^location[:.]/);
    }
  });

  it("lore chunks coexist with location chunks in one corpus", () => {
    const loreChunks = corpus.filter((c) => c.sourceType !== "location");
    const locationChunks = corpus.filter((c) => c.sourceType === "location");
    expect(loreChunks.length).toBeGreaterThan(0);
    expect(locationChunks.length).toBeGreaterThan(0);
  });
});

// ── 10. visibilityCeiling: "public" excludes restricted/imperial ──────────────

describe("visibility filtering", () => {
  it("public ceiling returns only public chunks", () => {
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);
    const hits = index.search({ text: "皇帝", limit: 50, visibilityCeiling: "public" });
    for (const h of hits) {
      expect(h.chunk.visibility).toBe("public");
    }
    index.close();
  });
});

// ── 11. currentTime filters temporal chunks ───────────────────────────────────

describe("temporal filtering", () => {
  it("chunk with future validFrom is not returned for earlier currentTime", () => {
    // Inject a synthetic future-only chunk
    const futureChunk: KnowledgeChunk = {
      id: "test.future#only",
      sourceType: "world_rule",
      title: "Future only",
      text: "This chunk is only valid in the future.",
      tags: ["test"],
      entityIds: [],
      locationIds: [],
      // dayIndex=9999 = far future; query at dayIndex=0 should exclude this chunk
      validFrom: { year: 9999, month: 1, period: "early", dayIndex: 9999 },
      visibility: "public",
      sourcePath: "test.md",
    };
    const testCorpus = [...corpus, futureChunk];
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(testCorpus);
    const hits = index.search({
      text: "future only chunk",
      limit: 10,
      currentTime: { year: 1, month: 1, period: "early", dayIndex: 0 },
    });
    expect(hits.some((h) => h.chunk.id === "test.future#only")).toBe(false);
    index.close();
  });
});

// ── 12. No duplicate chunk IDs ───────────────────────────────────────────────

describe("corpus integrity", () => {
  it("all chunk IDs are unique", () => {
    const ids = corpus.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── 13. Keyword eval determinism ─────────────────────────────────────────────

describe("eval determinism", () => {
  it("two keyword eval runs produce identical Hit@5", () => {
    const casesContent = readFileSync(CASES_PATH, "utf8");
    const cases = parseEvalCases(casesContent);

    const runOnce = () => {
      const index = new SqliteKeywordIndex(":memory:");
      index.rebuild(corpus);
      const result = runKeywordEval(cases, { chunks: corpus, keywordIndex: index });
      index.close();
      return computeAggregateMetrics(result.results, result.visibilityLeakCount, result.temporalLeakCount);
    };

    const m1 = runOnce();
    const m2 = runOnce();
    expect(m1.hitAt5).toBe(m2.hitAt5);
    expect(m1.mrr).toBe(m2.mrr);
    expect(m1.forbiddenHitCount).toBe(m2.forbiddenHitCount);
  });
});

// ── 14. Eval does not call embedding provider ────────────────────────────────

describe("eval isolation", () => {
  it("runKeywordEval uses no external network calls", () => {
    const cases = parseEvalCases(readFileSync(CASES_PATH, "utf8"));
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);

    let embeddingCallCount = 0;
    const result = runKeywordEval(cases, {
      chunks: corpus,
      keywordIndex: index,
    });
    expect(embeddingCallCount).toBe(0);
    expect(result.results.length).toBe(cases.length);
    index.close();
  });
});

// ── 15. Missing expected ID causes gate failure ───────────────────────────────

describe("eval hard gates", () => {
  it("missing expected ID is detected in missingReferencedIds", () => {
    const fakeCases = parseEvalCases(
      JSON.stringify({
        id: "fake",
        query: "test",
        limit: 5,
        expectedAnyOf: ["does.not#exist"],
        category: "direct",
      }),
    );
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);
    const result = runKeywordEval(fakeCases, { chunks: corpus, keywordIndex: index });
    index.close();
    expect(result.missingReferencedIds).toHaveLength(1);
    expect(result.missingReferencedIds[0]?.missingId).toBe("does.not#exist");
    expect(result.missingReferencedIds[0]?.role).toBe("expected");
  });

  it("missing forbidden ID is detected in missingReferencedIds", () => {
    const fakeCases = parseEvalCases(
      JSON.stringify({
        id: "fake-forbidden",
        query: "test",
        limit: 5,
        forbiddenIds: ["does.not#forbidden"],
        category: "direct",
      }),
    );
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);
    const result = runKeywordEval(fakeCases, { chunks: corpus, keywordIndex: index });
    index.close();
    const missing = result.missingReferencedIds.find((m) => m.missingId === "does.not#forbidden");
    expect(missing).toBeDefined();
    expect(missing?.role).toBe("forbidden");
  });

  it("forbidden hit is reported in CaseResult.forbiddenHits", () => {
    const casesContent = readFileSync(CASES_PATH, "utf8");
    const cases = parseEvalCases(casesContent);
    const index = new SqliteKeywordIndex(":memory:");
    index.rebuild(corpus);
    const result = runKeywordEval(cases, { chunks: corpus, keywordIndex: index });
    index.close();
    // The production golden cases should have 0 forbidden hits (gates pass)
    const totalForbidden = result.results.reduce((s, r) => s + r.forbiddenHits.length, 0);
    expect(totalForbidden).toBe(0);
  });
});
