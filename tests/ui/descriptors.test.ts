// tests/ui/descriptors.test.ts
import { describe as group, expect, it } from "vitest";
import { DESCRIPTORS, describe, directionOf, tone } from "../../src/ui/format/descriptors";

group("describe band boundaries", () => {
  it("maps value to the right 10-band label", () => {
    expect(describe("appearance", 0)).toBe(DESCRIPTORS["appearance"]!.labels![0]);
    expect(describe("appearance", 9)).toBe(DESCRIPTORS["appearance"]!.labels![0]);
    expect(describe("appearance", 10)).toBe(DESCRIPTORS["appearance"]!.labels![1]);
    expect(describe("appearance", 95)).toBe(DESCRIPTORS["appearance"]!.labels![9]);
    expect(describe("appearance", 100)).toBe(DESCRIPTORS["appearance"]!.labels![9]); // clamp
  });
  it("falls back to the number string for an unknown scale", () => {
    expect(describe("nope" as never, 42)).toBe("42");
  });
});

group("labelsByKind", () => {
  it("favor differs by kind and both are 10 long", () => {
    const c = describe("favor", 95, "consort");
    const h = describe("favor", 95, "heir");
    expect(c).not.toBe(h);
    expect(DESCRIPTORS["favor"]!.labelsByKind!.consort).toHaveLength(10);
    expect(DESCRIPTORS["favor"]!.labelsByKind!.heir).toHaveLength(10);
  });
});

group("directionOf", () => {
  it.each(["cruelty", "corruption", "clanDiscontent", "rumor", "clanPowerNation"] as const)(
    "%s is lower_is_better", (s) => expect(directionOf(s)).toBe("lower_is_better"),
  );
  it("a positive scale and an unknown scale are higher_is_better", () => {
    expect(directionOf("health")).toBe("higher_is_better");
    expect(directionOf("nope" as never)).toBe("higher_is_better");
  });
});

group("tone", () => {
  it("high value on a positive scale is good; on a negative scale is bad", () => {
    expect(tone("health", 95)).toBe("good");
    expect(tone("health", 5)).toBe("bad");
    expect(tone("cruelty", 95)).toBe("bad");
    expect(tone("cruelty", 5)).toBe("good");
    expect(tone("health", 50)).toBe("neutral");
  });
});

group("every config is well-formed", () => {
  it("each scale resolves to a 10-entry label set with no blanks (negatives end badly)", () => {
    for (const [id, cfg] of Object.entries(DESCRIPTORS)) {
      const sets = cfg.labels ? [cfg.labels] : Object.values(cfg.labelsByKind ?? {});
      expect(sets.length, id).toBeGreaterThan(0);
      for (const set of sets) {
        expect(set, id).toHaveLength(10);
        expect(set!.every((s) => s.length > 0), id).toBe(true);
      }
    }
    expect(DESCRIPTORS["clanPowerNation"]!.labels![9]).toBe("外戚专权");
    expect(DESCRIPTORS["cruelty"]!.labels![9]).toContain("杀");
  });
});
