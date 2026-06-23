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

  it("produces identical chunks regardless of extra blank lines around headings", () => {
    const tight = `---
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
    // Extra blank lines before/after the heading line
    const loose = tight.replace("## Heading\n", "\n## Heading\n\n");
    const r1 = parseMarkdownLore(tight, "test.md");
    const r2 = parseMarkdownLore(loose, "test.md");
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    // IDs and text should be identical (section text is trimmed)
    expect(r1.value.map((c) => c.id)).toEqual(r2.value.map((c) => c.id));
    expect(r1.value.map((c) => c.text)).toEqual(r2.value.map((c) => c.text));
  });
});

describe("parseMarkdownLore — hierarchical heading IDs", () => {
  it("H3 sections under different H2 parents get unique IDs", () => {
    const content = `---
id: hierarchy.test
sourceType: official_system
title: 官员体系
tags: []
entityIds: []
locationIds: []
visibility: public
---

## 中书省

中书省的职责概述。

### 职责

中书省负责起草诏书，辅佐皇帝处理政务。

## 尚书省

尚书省的职责概述。

### 职责

尚书省负责执行政令，管理六部日常。
`;
    const result = parseMarkdownLore(content, "hierarchy.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((c) => c.id);
    // Both H3 "职责" sections must get distinct IDs via the H2 parent
    expect(ids).toContain("hierarchy.test#中书省/职责");
    expect(ids).toContain("hierarchy.test#尚书省/职责");
    // No duplicates
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("H3 chunk title includes parent H2 for context", () => {
    const content = `---
id: title.test
sourceType: official_system
title: 文档标题
tags: []
entityIds: []
locationIds: []
visibility: public
---

## 中书省

中书省概述。

### 职责

中书省负责起草诏书。
`;
    const result = parseMarkdownLore(content, "title-test.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const h3Chunk = result.value.find((c) => c.id.includes("/职责"));
    expect(h3Chunk).toBeDefined();
    // Title carries both H2 and H3 context
    expect(h3Chunk!.title).toContain("中书省");
    expect(h3Chunk!.title).toContain("职责");
  });
});

describe("parseMarkdownLore — strict frontmatter validation", () => {
  it("unknown frontmatter key (e.g. typo validUntillYear) causes schema error", () => {
    const content = `---
id: typo.test
sourceType: etiquette
title: Test
tags: []
entityIds: []
locationIds: []
visibility: public
validUntillYear: 3
---

## Section

Content here.
`;
    const result = parseMarkdownLore(content, "typo.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "SCHEMA")).toBe(true);
  });

  it("duplicate frontmatter key causes DUPLICATE_KEY error", () => {
    const content = `---
id: dup.test
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
    const result = parseMarkdownLore(content, "dup.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "DUPLICATE_KEY")).toBe(true);
  });

  it("frontmatter line without colon causes INVALID_FRONTMATTER error", () => {
    const content = `---
id: nocolon.test
sourceType etiquette
title: Test
tags: []
entityIds: []
locationIds: []
visibility: public
---

## Section

Content.
`;
    const result = parseMarkdownLore(content, "nocolon.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "INVALID_FRONTMATTER")).toBe(true);
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
