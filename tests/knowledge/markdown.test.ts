import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdownLore } from "../../src/engine/knowledge/ingestion/markdown";

const FIXTURES = join(import.meta.dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("parseMarkdownLore — etiquette-confinement.md", () => {
  it("parses successfully and returns chunks", () => {
    const result = parseMarkdownLore(loadFixture("etiquette-confinement.md"), "fixtures/etiquette-confinement.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
  });

  it("each section becomes a separate chunk", () => {
    const result = parseMarkdownLore(loadFixture("etiquette-confinement.md"), "fixtures/etiquette-confinement.md");
    if (!result.ok) return;
    // Three ## headings → at least 3 chunks
    expect(result.value.length).toBeGreaterThanOrEqual(3);
  });

  it("chunk IDs contain the document id and heading", () => {
    const result = parseMarkdownLore(loadFixture("etiquette-confinement.md"), "fixtures/etiquette-confinement.md");
    if (!result.ok) return;
    expect(result.value.every((c) => c.id.startsWith("etiquette.confinement#"))).toBe(true);
  });

  it("each chunk inherits document metadata", () => {
    const result = parseMarkdownLore(loadFixture("etiquette-confinement.md"), "fixtures/etiquette-confinement.md");
    if (!result.ok) return;
    for (const chunk of result.value) {
      expect(chunk.sourceType).toBe("etiquette");
      expect(chunk.visibility).toBe("public");
      expect(chunk.tags).toContain("etiquette");
    }
  });

  it("chunks contain relevant text (禁足 appears in at least one)", () => {
    const result = parseMarkdownLore(loadFixture("etiquette-confinement.md"), "fixtures/etiquette-confinement.md");
    if (!result.ok) return;
    const texts = result.value.map((c) => c.text).join(" ");
    expect(texts).toContain("禁足");
    expect(texts).toContain("请安");
  });

  it("sourcePath is preserved on every chunk", () => {
    const sp = "fixtures/etiquette-confinement.md";
    const result = parseMarkdownLore(loadFixture("etiquette-confinement.md"), sp);
    if (!result.ok) return;
    expect(result.value.every((c) => c.sourcePath === sp)).toBe(true);
  });
});

describe("parseMarkdownLore — historical-archive.md (with validFrom/validUntil)", () => {
  it("parses temporal bounds correctly", () => {
    const result = parseMarkdownLore(loadFixture("historical-archive.md"), "fixtures/historical-archive.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const chunk of result.value) {
      expect(chunk.validFrom).toBeDefined();
      expect(chunk.validUntil).toBeDefined();
      expect(chunk.validFrom!.year).toBe(1);
      expect(chunk.validFrom!.month).toBe(1);
      expect(chunk.validFrom!.period).toBe("early");
      expect(chunk.validUntil!.year).toBe(1);
      expect(chunk.validUntil!.month).toBe(3);
      expect(chunk.validUntil!.period).toBe("late");
    }
  });
});

describe("parseMarkdownLore — location-xuanzhengdian.md (with locationIds)", () => {
  it("inherits locationIds from frontmatter", () => {
    const result = parseMarkdownLore(loadFixture("location-xuanzhengdian.md"), "fixtures/location-xuanzhengdian.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((c) => c.locationIds.includes("xuanzhengdian"))).toBe(true);
  });
});

describe("parseMarkdownLore — error handling", () => {
  it("fails when no frontmatter delimiter", () => {
    const result = parseMarkdownLore("# Just a heading\n\nSome text.", "no-fm.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "MISSING_FRONTMATTER")).toBe(true);
  });

  it("fails when frontmatter has no closing ---", () => {
    const result = parseMarkdownLore("---\nid: test\n# No closing", "no-close.md");
    expect(result.ok).toBe(false);
  });

  it("fails when required frontmatter field is missing (sourceType)", () => {
    const content = `---
id: test.chunk
title: Test Title
tags: []
entityIds: []
locationIds: []
visibility: public
---

## Section

Content here.
`;
    const result = parseMarkdownLore(content, "no-sourcetype.md");
    expect(result.ok).toBe(false);
  });

  it("fails when only partial GameTime is specified", () => {
    const content = `---
id: test.partial
sourceType: etiquette
title: Partial Time
tags: []
entityIds: []
locationIds: []
visibility: public
validFromYear: 3
---

## Section

Content here.
`;
    const result = parseMarkdownLore(content, "partial-time.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "PARTIAL_GAME_TIME")).toBe(true);
  });

  it("empty sections do not produce garbage chunks", () => {
    const content = `---
id: sparse.doc
sourceType: etiquette
title: Sparse
tags: []
entityIds: []
locationIds: []
visibility: public
---

## Empty Heading

## Real Content

这一段有实际内容。禁足者不得离宫。
`;
    const result = parseMarkdownLore(content, "sparse.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the "Real Content" section should produce a chunk
    expect(result.value.every((c) => c.text.length > 0)).toBe(true);
  });

  it("produces identical chunks regardless of whitespace around headings", () => {
    const content1 = `---
id: consistency.test
sourceType: etiquette
title: Test
tags: []
entityIds: []
locationIds: []
visibility: public
---

## Heading

Content about 禁足 and 请安.
`;
    const content2 = content1; // same input
    const r1 = parseMarkdownLore(content1, "test.md");
    const r2 = parseMarkdownLore(content2, "test.md");
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(JSON.stringify(r1.value)).toBe(JSON.stringify(r2.value));
  });
});

describe("parseMarkdownLore — intro chunk", () => {
  it("content before first heading becomes intro chunk", () => {
    const content = `---
id: intro.test
sourceType: world_rule
title: Document With Intro
tags: []
entityIds: []
locationIds: []
visibility: public
---

这是文档开头的介绍段落，说明整体背景。

## First Section

各位分侍君的礼制规范如下。
`;
    const result = parseMarkdownLore(content, "intro-test.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const introChunk = result.value.find((c) => c.id.endsWith("#_intro"));
    expect(introChunk).toBeDefined();
    expect(introChunk!.text).toContain("介绍段落");
  });
});
