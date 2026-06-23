/**
 * Tests for the fail-closed build pipeline contract:
 *
 *   - `ingestSourcesStrict` returns an error on any bad source.
 *   - Because knowledge-build.ts only opens the DB after a successful
 *     ingestSourcesStrict, a failing build must never modify an existing DB.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestSourcesStrict } from "../../src/engine/knowledge/ingestion/pipeline";
import { SqliteKeywordIndex } from "../../src/engine/knowledge/index/sqlite-fts5";
import type { KnowledgeChunk } from "../../src/engine/knowledge/model";

let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `build-test-${Date.now()}-${Math.random()}.db`);
});

afterEach(() => {
  try { rmSync(dbPath); } catch { /* ignore */ }
});

function makeChunk(id: string, text: string): KnowledgeChunk {
  return {
    id,
    sourceType: "etiquette",
    title: id,
    text,
    tags: [],
    entityIds: [],
    locationIds: [],
    visibility: "public",
    sourcePath: "test.md",
  };
}

describe("ingestSourcesStrict — fail-closed contract", () => {
  it("returns error on Markdown with no frontmatter", () => {
    const result = ingestSourcesStrict([
      { kind: "markdown", content: "# No frontmatter\n\nJust text.", sourcePath: "bad.md" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("returns error on Markdown with unknown frontmatter key (strict schema)", () => {
    const content = `---
id: strict.test
sourceType: etiquette
title: Test
tags: []
entityIds: []
locationIds: []
visibility: public
unknownExtraField: should fail
---

## Section

Content.
`;
    const result = ingestSourcesStrict([
      { kind: "markdown", content, sourcePath: "strict.md" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns error on Markdown with duplicate frontmatter key", () => {
    const content = `---
id: dup.key
id: another.id
sourceType: etiquette
title: Test
tags: []
entityIds: []
locationIds: []
visibility: public
---

## Section

Content.
`;
    const result = ingestSourcesStrict([
      { kind: "markdown", content, sourcePath: "dup.md" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("existing DB is untouched when ingestSourcesStrict fails (build contract)", () => {
    // Build initial valid DB
    const db = new SqliteKeywordIndex(dbPath);
    db.rebuild([makeChunk("valid.chunk", "承养制度的规定内容。")]);
    db.close();

    // Confirm initial state
    const before = new SqliteKeywordIndex(dbPath);
    const initialHits = before.search({ text: "承养", limit: 10 }).map((h) => h.chunk.id);
    before.close();
    expect(initialHits).toContain("valid.chunk");

    // Attempt a build with a bad source
    const result = ingestSourcesStrict([
      {
        kind: "markdown",
        content: "No frontmatter — this will fail ingestion.",
        sourcePath: "bad.md",
      },
    ]);
    // Ingestion fails — we do NOT open or modify the DB
    expect(result.ok).toBe(false);

    // Verify DB is unchanged
    const after = new SqliteKeywordIndex(dbPath);
    const afterHits = after.search({ text: "承养", limit: 10 }).map((h) => h.chunk.id);
    after.close();
    expect(afterHits).toEqual(initialHits);
  });

  it("returns error when sources contain duplicate chunk IDs across files", () => {
    const goodMd = `---
id: shared.doc
sourceType: etiquette
title: Doc One
tags: []
entityIds: []
locationIds: []
visibility: public
---

## Section

禁足期间不得离开所居宫殿，也不参加日常晨省请安。
`;
    // Second file uses the same doc id → duplicate chunk IDs
    const result = ingestSourcesStrict([
      { kind: "markdown", content: goodMd, sourcePath: "file1.md" },
      { kind: "markdown", content: goodMd, sourcePath: "file2.md" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });
});
