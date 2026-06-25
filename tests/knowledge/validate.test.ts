/**
 * Tests for the canonical consistency validator.
 *
 * These tests call the REAL production functions from
 * src/engine/knowledge/authoring/validate.ts — not re-implementations.
 * This ensures that the parser and validator share the same anchor logic.
 */
import { describe, expect, it } from "vitest";
import {
  validateCanonicalRanks,
  validateLoreDocument,
  validateLoreBodyForDeprecatedTerms,
  collectDeprecatedTerms,
} from "../../src/engine/knowledge/authoring/validate";
import { parseMarkdownLore } from "../../src/engine/knowledge/ingestion/markdown";
import { loadRealContent } from "../helpers/contentFixture";
import type { CharacterRank } from "../../src/engine/content/schemas";

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

function makeRank(overrides: Partial<CharacterRank> = {}): CharacterRank {
  return {
    id: "test-rank",
    name: "测试位",
    aliases: [],
    deprecatedAliases: [],
    grade: "正五品",
    selfRefs: { toPlayer: ["妾"], formal: ["妾"] },
    order: 100,
    domain: "harem",
    favorTerm: "恩宠",
    deprecated: false,
    ...overrides,
  };
}

function errCodes(findings: ReturnType<typeof validateCanonicalRanks>) {
  return findings.filter((f) => f.kind === "error").map((f) => f.code);
}

// ── validateCanonicalRanks ────────────────────────────────────────────────────

describe("validateCanonicalRanks", () => {
  it("passes for a minimal valid rank list", () => {
    const ranks = [makeRank({ id: "a", name: "甲", order: 10 }), makeRank({ id: "b", name: "乙", order: 20 })];
    expect(validateCanonicalRanks(ranks)).toHaveLength(0);
  });

  it("detects duplicate rank IDs", () => {
    const ranks = [makeRank({ id: "dup", name: "甲", order: 10 }), makeRank({ id: "dup", name: "乙", order: 20 })];
    expect(errCodes(validateCanonicalRanks(ranks))).toContain("DUPLICATE_RANK_ID");
  });

  it("detects duplicate non-deprecated names", () => {
    const ranks = [
      makeRank({ id: "a", name: "甲", order: 10 }),
      makeRank({ id: "b", name: "甲", order: 20 }),
    ];
    expect(errCodes(validateCanonicalRanks(ranks))).toContain("DUPLICATE_RANK_NAME");
  });

  it("allows deprecated rank to share name with another deprecated rank (both excluded from name check)", () => {
    const ranks = [
      makeRank({ id: "a", name: "甲", order: 10, deprecated: true }),
      makeRank({ id: "b", name: "甲", order: 20, deprecated: true }),
    ];
    const codes = errCodes(validateCanonicalRanks(ranks));
    expect(codes).not.toContain("DUPLICATE_RANK_NAME");
  });

  it("detects duplicate order within the same domain", () => {
    const ranks = [makeRank({ id: "a", name: "甲", order: 50 }), makeRank({ id: "b", name: "乙", order: 50 })];
    expect(errCodes(validateCanonicalRanks(ranks))).toContain("DUPLICATE_RANK_ORDER");
  });

  it("allows same order in different domains", () => {
    const ranks = [
      makeRank({ id: "a", name: "甲", order: 50, domain: "harem" }),
      makeRank({ id: "b", name: "乙", order: 50, domain: "official" }),
    ];
    expect(validateCanonicalRanks(ranks)).toHaveLength(0);
  });

  it("detects cross-rank alias conflict", () => {
    const ranks = [
      makeRank({ id: "a", name: "甲", order: 10, aliases: ["共享别名"] }),
      makeRank({ id: "b", name: "乙", order: 20, aliases: ["共享别名"] }),
    ];
    expect(errCodes(validateCanonicalRanks(ranks))).toContain("AMBIGUOUS_TERM");
  });

  it("detects alias-deprecatedAlias conflict on same rank", () => {
    const ranks = [makeRank({ id: "a", name: "甲", aliases: ["别"], deprecatedAliases: ["别"] })];
    expect(errCodes(validateCanonicalRanks(ranks))).toContain("ALIAS_DEPRECATED_CONFLICT");
  });

  it("detects intra-rank duplicate terms", () => {
    const ranks = [makeRank({ id: "a", name: "甲", aliases: ["同", "同"] })];
    expect(errCodes(validateCanonicalRanks(ranks))).toContain("INTRA_RANK_DUPLICATE");
  });
});

// ── validateLoreDocument ──────────────────────────────────────────────────────

describe("validateLoreDocument: anchor enforcement", () => {
  it("H2 without anchor is flagged when requireAnchors=true", () => {
    const content = makeDoc("## 后宫位分顺序\n\n位分按品级排列，不得僭越。\n");
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(errCodes(findings)).toContain("MISSING_ANCHOR");
  });

  it("H3 without anchor is flagged when requireAnchors=true", () => {
    const content = makeDoc("## 位分 {#ranks}\n\n位分概述。\n\n### 对皇帝的自称\n\n对皇帝用臣妾。\n");
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(errCodes(findings)).toContain("MISSING_ANCHOR");
  });

  it("headings without anchors are NOT flagged when requireAnchors=false (fixture mode)", () => {
    const content = makeDoc("## 后宫位分顺序\n\n位分按品级排列，不得僭越。\n");
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: false });
    expect(errCodes(findings)).not.toContain("MISSING_ANCHOR");
  });

  it("all headings with anchors passes clean", () => {
    const content = makeDoc("## 位分 {#ranks}\n\n概述。\n\n### 高位 {#high-rank}\n\n说明。\n");
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(findings).toHaveLength(0);
  });
});

describe("validateLoreDocument: anchor uses SAME regex as parser", () => {
  it("anchor in middle of heading is NOT recognised — parser and validator agree", () => {
    // "{#rank-order} 旧备注" after the anchor would make the heading fail the end-anchor check
    // The parser won't extract the anchor either, so both agree: no stable anchor.
    const headingContent = `## 后宫位分 {#rank-order} 旧备注`;
    const content = makeDoc(`${headingContent}\n\n位分按品级排列，不得僭越。\n`);

    // Validator must flag it as MISSING_ANCHOR (because anchor is not at end)
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(errCodes(findings)).toContain("MISSING_ANCHOR");

    // Parser must also NOT extract the anchor (chunk ID uses full heading text, not just "rank-order")
    const result = parseMarkdownLore(content, "test.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Chunk ID should be the full heading text including the {#...} notation — not just the anchor value
    expect(result.value[0]!.id).not.toBe("test.doc#rank-order");
    // The full heading text is used as the path component
    expect(result.value[0]!.id).toContain("后宫位分");
  });

  it("valid end-anchor is recognised by both validator and parser", () => {
    const content = makeDoc("## 后宫位分 {#rank-order}\n\n位分按品级排列，不得僭越。\n");

    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(findings).toHaveLength(0);

    const result = parseMarkdownLore(content, "test.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.id).toContain("rank-order");
  });
});

describe("validateLoreDocument: duplicate anchors", () => {
  it("duplicate anchor within a document is detected", () => {
    const content = makeDoc(
      "## 第一节 {#section-one}\n\n内容一，足够长度。\n\n## 第二节 {#section-one}\n\n内容二，足够长度。\n",
    );
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(errCodes(findings)).toContain("DUPLICATE_ANCHOR");
  });

  it("unique anchors produce no duplicate error", () => {
    const content = makeDoc(
      "## 第一节 {#section-one}\n\n内容一，足够长度。\n\n## 第二节 {#section-two}\n\n内容二，足够长度。\n",
    );
    const findings = validateLoreDocument({ content, label: "test.md", requireAnchors: true });
    expect(errCodes(findings)).not.toContain("DUPLICATE_ANCHOR");
  });
});

describe("validateLoreDocument: forbidden keywords", () => {
  it("TODO is flagged", () => {
    const content = makeDoc("## 规则 {#rules}\n\nTODO: 待补充具体规则。\n");
    expect(errCodes(validateLoreDocument({ content, label: "test.md", requireAnchors: true }))).toContain("FORBIDDEN_KEYWORD");
  });

  it("TBD is flagged", () => {
    const content = makeDoc("## 规则 {#rules}\n\n转胎月数 TBD。\n");
    expect(errCodes(validateLoreDocument({ content, label: "test.md", requireAnchors: true }))).toContain("FORBIDDEN_KEYWORD");
  });

  it("【待定】 is flagged", () => {
    const content = makeDoc("## 规则 {#rules}\n\n承养月数【待定】。\n");
    expect(errCodes(validateLoreDocument({ content, label: "test.md", requireAnchors: true }))).toContain("FORBIDDEN_KEYWORD");
  });

  it("暂定原则 is flagged", () => {
    const content = makeDoc("## 规则 {#rules}\n\n暂定原则：三月转胎。\n");
    expect(errCodes(validateLoreDocument({ content, label: "test.md", requireAnchors: true }))).toContain("FORBIDDEN_KEYWORD");
  });

  it("clean body passes", () => {
    const content = makeDoc("## 规则 {#rules}\n\n承养制度规则已确定，请遵守。\n");
    expect(errCodes(validateLoreDocument({ content, label: "test.md", requireAnchors: true }))).not.toContain("FORBIDDEN_KEYWORD");
  });
});

// ── validateLoreBodyForDeprecatedTerms ────────────────────────────────────────

describe("validateLoreBodyForDeprecatedTerms", () => {
  it("deprecated alias in body text is flagged", () => {
    const findings = validateLoreBodyForDeprecatedTerms(
      "太子低位侧室称采仪，有时也称良仪。",
      "test.md",
      ["采仪"],
    );
    expect(errCodes(findings)).toContain("DEPRECATED_TERM_IN_LORE");
  });

  it("canonical name does not trigger the check", () => {
    const findings = validateLoreBodyForDeprecatedTerms(
      "太子低位侧室称良仪。",
      "test.md",
      ["采仪"],
    );
    expect(findings).toHaveLength(0);
  });

  it("deprecated rank name (官男子) is included in deprecated terms", () => {
    const db = loadRealContent();
    const terms = collectDeprecatedTerms(Object.values(db.ranks));
    expect(terms).toContain("官男子");
  });
});

// ── collectDeprecatedTerms ────────────────────────────────────────────────────

describe("collectDeprecatedTerms", () => {
  it("includes deprecatedAliases from all ranks", () => {
    const ranks = [makeRank({ id: "a", name: "甲", deprecatedAliases: ["旧甲"] })];
    expect(collectDeprecatedTerms(ranks)).toContain("旧甲");
  });

  it("includes name of deprecated ranks", () => {
    const ranks = [makeRank({ id: "old", name: "官男子", deprecated: true })];
    expect(collectDeprecatedTerms(ranks)).toContain("官男子");
  });

  it("does NOT include name of non-deprecated ranks", () => {
    const ranks = [makeRank({ id: "a", name: "更衣", deprecated: false })];
    expect(collectDeprecatedTerms(ranks)).not.toContain("更衣");
  });
});

// ── Integration: real world.json passes rank validation ───────────────────────

describe("world.json rank integrity", () => {
  it("all ranks in world.json pass canonical rank validation", () => {
    const db = loadRealContent();
    const findings = validateCanonicalRanks(Object.values(db.ranks));
    expect(findings.filter((f) => f.kind === "error")).toHaveLength(0);
  });
});
