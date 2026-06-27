import { describe, it, expect } from "vitest";
import {
  TITLE_EPITHETS,
  getEpithetCandidates,
} from "../../src/engine/characters/epithetPool";

describe("TITLE_EPITHETS", () => {
  it("has no duplicate chars", () => {
    const chars = TITLE_EPITHETS.map((e) => e.char);
    const unique = new Set(chars);
    expect(unique.size).toBe(chars.length);
  });

  it("every char is 1 CJK character", () => {
    for (const e of TITLE_EPITHETS) {
      expect(e.char).toMatch(/^[一-龥]$/);
    }
  });

  it("every entry has at least one tag", () => {
    for (const e of TITLE_EPITHETS) {
      expect(e.tags.length).toBeGreaterThan(0);
    }
  });

  it("every entry has at least one suitableFor target", () => {
    for (const e of TITLE_EPITHETS) {
      expect(e.suitableFor.length).toBeGreaterThan(0);
    }
  });
});

describe("getEpithetCandidates", () => {
  it("returns exactly count items by default", () => {
    const result = getEpithetCandidates({ target: "consort" });
    expect(result).toHaveLength(3);
  });

  it("respects custom count", () => {
    const result = getEpithetCandidates({ target: "consort", count: 5 });
    expect(result).toHaveLength(5);
  });

  it("all results are suitable for the target", () => {
    for (const target of ["consort", "empress", "prince"] as const) {
      const result = getEpithetCandidates({ target, count: 5 });
      for (const e of result) {
        expect(e.suitableFor).toContain(target);
      }
    }
  });

  it("excludes chars in excludeChars", () => {
    const first = getEpithetCandidates({ target: "consort", count: 3 });
    const excluded = first.map((e) => e.char);
    const second = getEpithetCandidates({
      target: "consort",
      count: 3,
      excludeChars: excluded,
    });
    for (const e of second) {
      expect(excluded).not.toContain(e.char);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = getEpithetCandidates({ target: "consort", seed: "char_001" });
    const b = getEpithetCandidates({ target: "consort", seed: "char_001" });
    expect(a.map((e) => e.char)).toEqual(b.map((e) => e.char));
  });

  it("pinned snapshot for seed char_001 with target consort", () => {
    const result = getEpithetCandidates({ target: "consort", seed: "char_001" });
    expect(result.map((e) => e.char)).toEqual(["安", "静", "惠"]);
  });

  it("10 distinct seeds produce varied results (hash dispersion)", () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      getEpithetCandidates({ target: "consort", seed: `seed_${i}` })
        .map((e) => e.char)
        .join(""),
    );
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it("multi-char existing title excludes each char individually", () => {
    const result = getEpithetCandidates({
      target: "consort",
      excludeChars: Array.from("昭宁"),
      seed: "test",
    });
    for (const e of result) {
      expect(e.char).not.toBe("昭");
      expect(e.char).not.toBe("宁");
    }
  });

  it("chars used by other consorts are excluded from candidates", () => {
    const otherUsedChars = ["惠", "德", "淑", "贤", "庄"];
    const result = getEpithetCandidates({
      target: "consort",
      excludeChars: otherUsedChars,
      seed: "char_001",
    });
    for (const e of result) {
      expect(otherUsedChars).not.toContain(e.char);
    }
  });

  it("preferredTags places matching entries first", () => {
    const result = getEpithetCandidates({
      target: "consort",
      count: 3,
      preferredTags: ["后宫"],
      seed: "test",
    });
    expect(result[0]?.tags).toContain("后宫");
  });

  it("no result has rarity=rare when default rarity filter is used", () => {
    const result = getEpithetCandidates({ target: "consort", count: 10 });
    for (const e of result) {
      expect(e.rarity).not.toBe("rare");
    }
  });

  it("can include rare when explicitly requested", () => {
    const result = getEpithetCandidates({
      target: "consort",
      count: 10,
      rarity: ["rare"],
      seed: "test",
    });
    for (const e of result) {
      expect(e.rarity).toBe("rare");
    }
  });
});
