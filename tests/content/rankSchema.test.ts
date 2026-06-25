/**
 * Tests for PR7A CharacterRank schema extensions:
 * - aliases / deprecatedAliases / deprecated fields
 * - guannanzi marked deprecated
 * - apMax = 5 in initial state
 */
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { characterRankSchema } from "../../src/engine/content/schemas";

describe("CharacterRank schema extensions", () => {
  it("round-trips a rank with aliases and deprecatedAliases", () => {
    const raw = {
      id: "huangguijun",
      name: "皇贵君",
      aliases: ["皇贵"],
      deprecatedAliases: ["皇宠君"],
      grade: "从一品",
      selfRefs: { toPlayer: ["本宫"], formal: ["妾身"] },
      order: 10,
      domain: "harem",
      favorTerm: "宠爱",
    };
    const parsed = characterRankSchema.parse(raw);
    expect(parsed.aliases).toEqual(["皇贵"]);
    expect(parsed.deprecatedAliases).toEqual(["皇宠君"]);
    expect(parsed.deprecated).toBe(false);
  });

  it("aliases defaults to empty array when omitted", () => {
    const raw = {
      id: "chenghui",
      name: "承徽",
      grade: "正五品",
      selfRefs: { toPlayer: ["妾"], formal: ["妾"] },
      order: 60,
      domain: "harem",
      favorTerm: "恩宠",
    };
    const parsed = characterRankSchema.parse(raw);
    expect(parsed.aliases).toEqual([]);
    expect(parsed.deprecatedAliases).toEqual([]);
    expect(parsed.deprecated).toBe(false);
  });

  it("deprecated defaults to false when omitted", () => {
    const raw = {
      id: "liangji",
      name: "良娣",
      grade: "正三品",
      selfRefs: { toPlayer: ["妾"], formal: ["妾"] },
      order: 30,
      domain: "harem",
      favorTerm: "眷顾",
    };
    const parsed = characterRankSchema.parse(raw);
    expect(parsed.deprecated).toBe(false);
  });

  it("accepts deprecated: true for a rank being phased out", () => {
    const raw = {
      id: "guannanzi",
      name: "官男子",
      grade: "九品",
      selfRefs: { toPlayer: ["小侍"], formal: ["我"] },
      order: 40,
      domain: "harem",
      favorTerm: "恩宠",
      deprecated: true,
    };
    const parsed = characterRankSchema.parse(raw);
    expect(parsed.deprecated).toBe(true);
  });

  it("rejects empty string in aliases array", () => {
    const raw = {
      id: "quanyi",
      name: "权仪",
      aliases: [""],
      grade: "正一品",
      selfRefs: { toPlayer: ["本宫"], formal: ["本宫"] },
      order: 5,
      domain: "harem",
      favorTerm: "宠幸",
    };
    expect(() => characterRankSchema.parse(raw)).toThrow();
  });
});

describe("guannanzi is deprecated in world.json", () => {
  it("guannanzi rank has deprecated: true", () => {
    const db = loadRealContent();
    const guannanzi = db.ranks["guannanzi"];
    expect(guannanzi).toBeDefined();
    expect(guannanzi!.deprecated).toBe(true);
  });

  it("non-deprecated ranks do not have deprecated: true", () => {
    const db = loadRealContent();
    const canonicalRanks = Object.values(db.ranks).filter((r) => !r.deprecated);
    expect(canonicalRanks.length).toBeGreaterThan(0);
    for (const rank of canonicalRanks) {
      expect(rank.deprecated).toBe(false);
    }
  });
});

describe("apMax in world.json", () => {
  it("world.json calendar.apMax is 5", () => {
    const db = loadRealContent();
    expect(db.world.calendar.apMax).toBe(5);
  });
});
