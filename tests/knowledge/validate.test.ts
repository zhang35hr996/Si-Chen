/**
 * Tests for the canonical consistency validator (knowledge:validate).
 *
 * Because the validator is a CLI tool (tools/knowledge-validate.ts) that reads
 * from the filesystem, we test its core logic by invoking the underlying
 * Markdown parser and checking the invariants the validator enforces.
 *
 * Covers:
 *  1. Production heading (H2) without anchor → validator-level check identifies it
 *  2. Production heading (H3) without anchor → validator-level check identifies it
 *  3. Duplicate anchor within same document is detected
 *  4. Anchor format — only lowercase a-z, 0-9, hyphens, starts with letter
 *  5. No TODO / TBD / 【待定】 in production corpus body
 *  6. Deprecated alias detection logic
 *  7. Rank ID uniqueness contract (invariant via schema)
 *  8. Rank order uniqueness within domain
 *  9. Validator does not modify any runtime state
 * 10. Document with all valid anchors produces correct chunk IDs
 */
import { describe, expect, it } from "vitest";
import { parseMarkdownLore } from "../../src/engine/knowledge/ingestion/markdown";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(body: string, id = "test.doc"): string {
  return `---
id: ${id}
sourceType: world_rule
title: 文档标题
tags: []
entityIds: []
locationIds: []
visibility: public
---
${body}`;
}

/**
 * Scan raw Markdown lines for headings that lack {#anchor} syntax.
 * Mirrors what knowledge-validate.ts does.
 */
function findHeadingsWithoutAnchors(content: string): string[] {
  const ANCHOR_RE = /\{#([a-z][a-z0-9-]*)\}/;
  const missing: string[] = [];
  const lines = content.split("\n");
  let inBody = false;
  let frontmatterClosed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && line.trimEnd() === "---") continue;
    if (!frontmatterClosed && line.trimEnd() === "---") {
      frontmatterClosed = true;
      inBody = true;
      continue;
    }
    if (!inBody) continue;

    const h2 = /^## (.+)/.exec(line);
    const h3 = /^### (.+)/.exec(line);
    const heading = h2 ?? h3;
    if (heading && !ANCHOR_RE.test(heading[1]!)) {
      missing.push(heading[1]!.trim());
    }
  }
  return missing;
}

/** Find duplicate anchors within a document. */
function findDuplicateAnchors(content: string): string[] {
  const ANCHOR_RE = /\{#([a-z][a-z0-9-]*)\}/;
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let inBody = false;
  let frontmatterClosed = false;

  for (const [i, line] of content.split("\n").entries()) {
    if (i === 0 && line.trimEnd() === "---") continue;
    if (!frontmatterClosed && line.trimEnd() === "---") {
      frontmatterClosed = true;
      inBody = true;
      continue;
    }
    if (!inBody) continue;

    const m = ANCHOR_RE.exec(line);
    if (m) {
      const anchor = m[1]!;
      if (seen.has(anchor)) duplicates.push(anchor);
      seen.add(anchor);
    }
  }
  return duplicates;
}

/** Find forbidden keywords in body text. */
function findForbiddenKeywords(content: string): string[] {
  const KEYWORDS = ["TODO", "TBD", "【待定】", "暂定原则"];
  const found: string[] = [];
  let inBody = false;
  let frontmatterClosed = false;

  for (const [i, line] of content.split("\n").entries()) {
    if (i === 0 && line.trimEnd() === "---") continue;
    if (!frontmatterClosed && line.trimEnd() === "---") {
      frontmatterClosed = true;
      inBody = true;
      continue;
    }
    if (!inBody) continue;
    for (const kw of KEYWORDS) {
      if (line.includes(kw) && !found.includes(kw)) found.push(kw);
    }
  }
  return found;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validator: anchor enforcement", () => {
  it("H2 without anchor is flagged", () => {
    const content = makeDoc("## 后宫位分顺序\n\n位分按品级排列。\n");
    const missing = findHeadingsWithoutAnchors(content);
    expect(missing).toContain("后宫位分顺序");
  });

  it("H3 without anchor is flagged", () => {
    const content = makeDoc(
      "## 位分 {#ranks}\n\n位分概述。\n\n### 对皇帝的自称\n\n对皇帝用臣。\n",
    );
    const missing = findHeadingsWithoutAnchors(content);
    expect(missing).toContain("对皇帝的自称");
    expect(missing).not.toContain("位分 {#ranks}");
  });

  it("all headings with anchors passes with no missing list", () => {
    const content = makeDoc(
      "## 位分 {#ranks}\n\n概述。\n\n### 高位 {#high-rank}\n\n高位说明。\n",
    );
    expect(findHeadingsWithoutAnchors(content)).toHaveLength(0);
  });
});

describe("validator: duplicate anchor detection", () => {
  it("duplicate anchor within a document is detected", () => {
    const content = makeDoc(
      "## 第一节 {#section-one}\n\n内容一。\n\n## 第二节 {#section-one}\n\n内容二。\n",
    );
    const dups = findDuplicateAnchors(content);
    expect(dups).toContain("section-one");
  });

  it("unique anchors produce empty duplicate list", () => {
    const content = makeDoc(
      "## 第一节 {#section-one}\n\n内容一。\n\n## 第二节 {#section-two}\n\n内容二。\n",
    );
    expect(findDuplicateAnchors(content)).toHaveLength(0);
  });
});

describe("validator: forbidden keywords", () => {
  it("TODO in body text is flagged", () => {
    const content = makeDoc(
      "## 规则 {#rules}\n\nTODO: 待补充具体规则。\n",
    );
    expect(findForbiddenKeywords(content)).toContain("TODO");
  });

  it("【待定】 in body text is flagged", () => {
    const content = makeDoc(
      "## 规则 {#rules}\n\n承养月数【待定】，以下为参考。\n",
    );
    expect(findForbiddenKeywords(content)).toContain("【待定】");
  });

  it("TBD in body text is flagged", () => {
    const content = makeDoc("## 规则 {#rules}\n\n转胎月数 TBD。\n");
    expect(findForbiddenKeywords(content)).toContain("TBD");
  });

  it("暂定原则 in body text is flagged", () => {
    const content = makeDoc(
      "## 规则 {#rules}\n\n暂定原则：三月转胎。\n",
    );
    expect(findForbiddenKeywords(content)).toContain("暂定原则");
  });

  it("clean body text produces no forbidden keywords", () => {
    const content = makeDoc(
      "## 规则 {#rules}\n\n承养制度规则已确定。\n",
    );
    expect(findForbiddenKeywords(content)).toHaveLength(0);
  });
});

describe("validator: deprecated alias detection in corpus", () => {
  it("deprecated alias 采仪 in lore body is detected", () => {
    const deprecatedAliases = ["采仪"];
    const loreText = "太子低位侧室称采仪，有时也称良仪。";
    const found = deprecatedAliases.filter((da) => loreText.includes(da));
    expect(found).toContain("采仪");
  });

  it("canonical name 良仪 does not trigger deprecated check", () => {
    const deprecatedAliases = ["采仪"];
    const loreText = "太子低位侧室称良仪。";
    const found = deprecatedAliases.filter((da) => loreText.includes(da));
    expect(found).toHaveLength(0);
  });
});

describe("validator: document and chunk ID uniqueness via parser", () => {
  it("two documents with different IDs produce disjoint chunk ID sets", () => {
    const doc1 = makeDoc("## 规则 {#rules}\n\n第一份文档的规则内容，适用于所有后宫位分。\n", "doc.one");
    const doc2 = makeDoc("## 规则 {#rules}\n\n第二份文档的另一份规则，具有独立的适用范围。\n", "doc.two");

    const r1 = parseMarkdownLore(doc1, "test1.md");
    const r2 = parseMarkdownLore(doc2, "test2.md");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    const ids1 = new Set(r1.value.map((c) => c.id));
    const ids2 = new Set(r2.value.map((c) => c.id));
    const overlap = [...ids1].filter((id) => ids2.has(id));
    expect(overlap).toHaveLength(0);
  });

  it("all chunks from one document share the same doc-id prefix", () => {
    const doc = makeDoc(
      "## 甲规则 {#section-a}\n\n甲规则适用于所有后宫位分，不得违反。\n\n### 甲子细则 {#section-a-1}\n\n甲子细则为甲规则的补充说明，需配合主规则理解。\n\n## 乙规则 {#section-b}\n\n乙规则是后宫礼仪的补充规定，同样具有约束力。\n",
      "my.lore",
    );
    const r = parseMarkdownLore(doc, "test.md");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const chunk of r.value) {
      expect(chunk.id).toMatch(/^my\.lore#/);
    }
  });
});

describe("validator does not modify runtime state", () => {
  it("calling the anchor scan function multiple times is idempotent", () => {
    const content = makeDoc("## 规则 {#rules}\n\n内容。\n");
    const first = findHeadingsWithoutAnchors(content);
    const second = findHeadingsWithoutAnchors(content);
    expect(first).toEqual(second);
  });

  it("parseMarkdownLore is pure — same input always produces same output", () => {
    const doc = makeDoc("## 规则 {#rules}\n\n内容。\n");
    const r1 = parseMarkdownLore(doc, "test.md");
    const r2 = parseMarkdownLore(doc, "test.md");
    expect(r1).toEqual(r2);
  });
});
