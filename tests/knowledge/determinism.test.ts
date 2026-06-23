/**
 * Determinism tests: verify that chunk IDs, order, and search results are
 * identical regardless of file enumeration order, metadata array order, or
 * object property insertion order.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeChunks } from "../../src/engine/knowledge/normalize";
import { ingestSources } from "../../src/engine/knowledge/ingestion/pipeline";
import { SqliteKeywordIndex } from "../../src/engine/knowledge/index/sqlite-fts5";
import type { GameError } from "../../src/engine/infra/errors";
import type { KnowledgeChunkInput } from "../../src/engine/knowledge/model";

function makeInput(id: string, text: string, tags: string[]): KnowledgeChunkInput {
  return {
    id,
    sourceType: "etiquette",
    title: `Title ${id}`,
    text,
    tags,
    entityIds: [],
    locationIds: [],
    visibility: "public",
    sourcePath: "test.md",
  };
}

describe("normalizeChunks — determinism", () => {
  it("same output regardless of input array order", () => {
    const a = makeInput("z.last", "禁足内容Z", ["punishment"]);
    const b = makeInput("a.first", "承养内容A", ["adoption"]);

    const e1: GameError[] = [];
    const r1 = normalizeChunks([a, b], e1);

    const e2: GameError[] = [];
    const r2 = normalizeChunks([b, a], e2); // reversed

    expect(r1.map((c) => c.id)).toEqual(r2.map((c) => c.id));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("metadata arrays are always sorted regardless of input order", () => {
    const input: KnowledgeChunkInput = {
      ...makeInput("test", "内容", ["c_tag", "a_tag", "b_tag"]),
      entityIds: ["entity_z", "entity_a"],
      locationIds: ["loc_b", "loc_a"],
    };
    const errors: GameError[] = [];
    const [chunk] = normalizeChunks([input], errors);
    expect(chunk!.tags).toEqual(["a_tag", "b_tag", "c_tag"]);
    expect(chunk!.entityIds).toEqual(["entity_a", "entity_z"]);
    expect(chunk!.locationIds).toEqual(["loc_a", "loc_b"]);
  });

  it("same result for object with different property insertion order", () => {
    // Simulate different JSON parse orders by constructing objects differently
    const input1: KnowledgeChunkInput = {
      id: "order.test",
      sourceType: "etiquette",
      title: "测试标题",
      text: "测试内容",
      tags: ["b", "a"],
      entityIds: [],
      locationIds: [],
      visibility: "public",
      sourcePath: "test.md",
    };
    const input2: KnowledgeChunkInput = {
      visibility: "public",
      sourcePath: "test.md",
      locationIds: [],
      entityIds: [],
      tags: ["a", "b"],
      text: "测试内容",
      title: "测试标题",
      sourceType: "etiquette",
      id: "order.test",
    };
    const e1: GameError[] = [];
    const e2: GameError[] = [];
    const r1 = normalizeChunks([input1], e1);
    const r2 = normalizeChunks([input2], e2);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe("ingestSources — determinism", () => {
  const md1 = `---
id: doc.alpha
sourceType: etiquette
title: 禁足礼制
tags:
  - etiquette
entityIds: []
locationIds: []
visibility: public
---

## 禁足

禁足期间不得请安。
`;

  const md2 = `---
id: doc.beta
sourceType: world_rule
title: 承养制度
tags:
  - adoption
entityIds: []
locationIds: []
visibility: public
---

## 承养

承养人须有位分。
`;

  it("produces identical chunks regardless of source order", () => {
    const e1: GameError[] = [];
    const r1 = ingestSources(
      [
        { kind: "markdown", content: md1, sourcePath: "alpha.md" },
        { kind: "markdown", content: md2, sourcePath: "beta.md" },
      ],
      e1,
    );

    const e2: GameError[] = [];
    const r2 = ingestSources(
      [
        { kind: "markdown", content: md2, sourcePath: "beta.md" },
        { kind: "markdown", content: md1, sourcePath: "alpha.md" },
      ],
      e2,
    );

    expect(r1.map((c) => c.id)).toEqual(r2.map((c) => c.id));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe("SqliteKeywordIndex — deterministic search results", () => {
  let dbPath: string;
  let index: SqliteKeywordIndex;

  beforeEach(() => {
    dbPath = join(tmpdir(), `det-test-${Date.now()}.db`);
    index = new SqliteKeywordIndex(dbPath);
  });

  afterEach(() => {
    index.close();
    try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it("same search query returns same ordered results on repeated calls", () => {
    const errors: GameError[] = [];
    const chunks = normalizeChunks(
      [
        makeInput("chunk.a", "禁足期间的礼制规范", ["etiquette"]),
        makeInput("chunk.b", "承养制度的规定条件", ["adoption"]),
        makeInput("chunk.c", "禁足与承养的交叉情况", ["etiquette", "adoption"]),
      ],
      errors,
    );
    index.rebuild(chunks);

    const h1 = index.search({ text: "禁足 承养", limit: 10 }).map((h) => h.chunk.id);
    const h2 = index.search({ text: "禁足 承养", limit: 10 }).map((h) => h.chunk.id);
    const h3 = index.search({ text: "禁足 承养", limit: 10 }).map((h) => h.chunk.id);

    expect(h1).toEqual(h2);
    expect(h2).toEqual(h3);
  });

  it("rebuilding with same chunks produces same search results", () => {
    const errors: GameError[] = [];
    const chunks = normalizeChunks(
      [
        makeInput("chunk.a", "禁足期间不得外出", ["etiquette"]),
        makeInput("chunk.b", "承养须有位分", ["adoption"]),
      ],
      errors,
    );

    index.rebuild(chunks);
    const h1 = index.search({ text: "禁足", limit: 10 }).map((h) => h.chunk.id);

    index.rebuild(chunks); // rebuild again with same data
    const h2 = index.search({ text: "禁足", limit: 10 }).map((h) => h.chunk.id);

    expect(h1).toEqual(h2);
  });
});
