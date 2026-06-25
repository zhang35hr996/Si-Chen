/**
 * Tests for stable heading anchor support in the Markdown knowledge parser.
 *
 * PR7A: chunk IDs must be decoupled from Chinese heading text so renaming a
 * heading does not change the chunk ID.  Stable anchors {#kebab-id} achieve
 * this — when present they replace the heading text in the ID path.
 *
 * Covers:
 *  1. H2 anchor becomes the ID path component instead of Chinese heading text
 *  2. H3 anchor under H2 anchor → parent-anchor/child-anchor path
 *  3. H3 anchor under H2 WITHOUT anchor → h2Text/child-anchor
 *  4. H2 WITHOUT anchor → heading text used as before (backward compat)
 *  5. Renaming Chinese heading text does not change chunk ID when anchor present
 *  6. Anchor-based ID differs from heading-text-based ID
 *  7. H2 display title strips the anchor notation
 *  8. H3 display title strips the anchor and uses Chinese text for parent
 *  9. _intro chunk ID is unaffected by anchor syntax in headings
 * 10. Split sub-chunks use anchor-derived path with :0 :1 suffix
 * 11. H3 with anchor under unlabelled H2 produces stable H3 path
 */
import { expect, it } from "vitest";
import { parseMarkdownLore } from "../../src/engine/knowledge/ingestion/markdown";

function parse(content: string) {
  const result = parseMarkdownLore(content, "test.md");
  if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
  return result.value;
}

const HEADER = `---
id: titles.test
sourceType: world_rule
title: 测试文档
tags: []
entityIds: []
locationIds: []
visibility: public
---
`;

const BODY = "位分按照品级高低严格排列，不得僭越。";

// ── 1. H2 anchor replaces Chinese text in ID ─────────────────────────────────
it("H2 anchor becomes the chunk ID component", () => {
  const md = HEADER + `## 后宫位分顺序 {#rank-order}\n\n${BODY}\n`;
  const chunks = parse(md);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.id).toBe("titles.test#rank-order");
});

// ── 2. H3 anchor under H2 anchor → parent/child path ─────────────────────────
it("H3 anchor under H2 anchor uses parent-anchor/child-anchor path", () => {
  const md =
    HEADER +
    `## 高位自称 {#high-rank-self-ref}\n\n高位妃嫔在正式场合使用本宫自称，不得省略。\n\n### 对皇帝的正式自称 {#to-emperor}\n\n面对皇帝时高位妃嫔一律自称臣妾，不得使用本宫。\n`;
  const chunks = parse(md);
  expect(chunks.map((c) => c.id)).toEqual([
    "titles.test#high-rank-self-ref",
    "titles.test#high-rank-self-ref/to-emperor",
  ]);
});

// ── 3. H3 anchor under H2 WITHOUT anchor ─────────────────────────────────────
it("H3 anchor under H2 without anchor uses h2Text/h3Anchor path", () => {
  const md =
    HEADER +
    `## 无锚父标题\n\n此标题没有锚点，但内容足够长以供测试使用。\n\n### 对皇帝的自称 {#to-emperor}\n\n面对皇帝时高位妃嫔一律自称臣妾，不得使用本宫。\n`;
  const chunks = parse(md);
  const ids = chunks.map((c) => c.id);
  expect(ids).toContain("titles.test#无锚父标题");
  expect(ids).toContain("titles.test#无锚父标题/to-emperor");
});

// ── 4. Backward compat: headings without anchors use text as before ───────────
it("headings without anchors fall back to Chinese text (backward compat)", () => {
  const md = HEADER + `## 承养制度\n\n承养是将胎息转给他人的制度，需经皇帝允许。\n`;
  const chunks = parse(md);
  expect(chunks[0]!.id).toBe("titles.test#承养制度");
});

// ── 5. Renaming Chinese heading text does NOT change chunk ID when anchor present
it("renaming Chinese heading text preserves chunk ID when anchor is present", () => {
  const old = HEADER + `## 后宫位分 {#rank-table}\n\n位分按照品级高低严格排列，不得僭越。\n`;
  const renamed = HEADER + `## 后宫位分顺序（全表） {#rank-table}\n\n位分按照品级高低严格排列，不得僭越。\n`;
  expect(parse(old)[0]!.id).toBe("titles.test#rank-table");
  expect(parse(renamed)[0]!.id).toBe("titles.test#rank-table");
});

// ── 6. Anchor ID differs from text ID ─────────────────────────────────────────
it("anchor-based ID differs from heading-text-based ID for the same heading", () => {
  const withAnchor = HEADER + `## 后宫位分 {#rank-table}\n\n位分按照品级高低严格排列，不得僭越。\n`;
  const withoutAnchor = HEADER + `## 后宫位分\n\n位分按照品级高低严格排列，不得僭越。\n`;
  expect(parse(withAnchor)[0]!.id).toBe("titles.test#rank-table");
  expect(parse(withoutAnchor)[0]!.id).toBe("titles.test#后宫位分");
});

// ── 7. H2 display title strips the anchor notation ────────────────────────────
it("H2 display title is the Chinese text without the {#anchor}", () => {
  const md = HEADER + `## 后宫位分顺序 {#rank-order}\n\n位分按照品级高低严格排列，不得僭越。\n`;
  const chunks = parse(md);
  expect(chunks[0]!.title).toBe("测试文档 — 后宫位分顺序");
});

// ── 8. H3 display title uses Chinese text for both parent and child ───────────
it("H3 display title uses Chinese parent and child text (no anchors in display)", () => {
  const md =
    HEADER +
    `## 高位自称 {#high-rank-self-ref}\n\n高位妃嫔在正式场合使用本宫自称，不得省略。\n\n### 对皇帝的正式自称 {#to-emperor}\n\n面对皇帝时高位妃嫔一律自称臣妾，不得使用本宫。\n`;
  const chunks = parse(md);
  const h3Chunk = chunks.find((c) => c.id.includes("/to-emperor"))!;
  expect(h3Chunk.title).toBe("测试文档 — 高位自称 — 对皇帝的正式自称");
});

// ── 9. _intro chunk ID is unaffected by anchor syntax ─────────────────────────
it("_intro chunk ID is not affected by anchor syntax in headings", () => {
  const md =
    HEADER +
    `本文档介绍宫廷称谓制度的完整规则，适用于所有后宫位分。\n\n## 位分 {#ranks}\n\n位分按照品级高低严格排列，不得僭越。\n`;
  const chunks = parse(md);
  expect(chunks[0]!.id).toBe("titles.test#_intro");
  expect(chunks[1]!.id).toBe("titles.test#ranks");
});

// ── 10. Split sub-chunks keep anchor-derived path with :0 :1 suffix ───────────
it("split sub-chunks use anchor-derived path with numeric suffixes", () => {
  // Two paragraphs separated by a blank line; each ≥450 chars so combined >800 → split
  const para1 = "承养制度的历史渊源可追溯至前朝，规定胎息须经皇帝下诏方可转给他人。".repeat(15);
  const para2 = "承养规则的补充细节如下：获准承养者须在三月内完成过继手续方为有效。".repeat(15);
  const md = HEADER + `## 承养说明 {#gestation-notes}\n\n${para1}\n\n${para2}\n`;
  const chunks = parse(md);
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  for (const chunk of chunks) {
    expect(chunk.id).toMatch(/^titles\.test#gestation-notes(:\d+)?$/);
  }
});

// ── 11. Anchor in H3 but not H2 is still stable on the H3 side ──────────────
it("H3 with anchor under unlabelled H2 produces stable H3 path", () => {
  const md =
    HEADER +
    `## 一般称谓\n\n一般称谓适用于所有宫廷场合，具体规则因位分而异。\n\n### 皇帝专用称谓 {#imperial-address}\n\n皇帝专用称谓为陛下，在正式场合不得简称或省略。\n`;
  const chunks = parse(md);
  const h3 = chunks.find((c) => c.id.includes("imperial-address"))!;
  expect(h3.id).toBe("titles.test#一般称谓/imperial-address");
});
