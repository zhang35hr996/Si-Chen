import { describe, expect, it } from "vitest";
import { healthRoll, healthRollRange, healthRollBasisPoints } from "../../src/engine/characters/healthRoll";

describe("healthRoll", () => {
  it("is deterministic for the same seed", () => {
    expect(healthRoll("a:1")).toBe(healthRoll("a:1"));
  });
  it("is in [0,99]", () => {
    for (const k of ["a", "b", "c", "d", "e"]) {
      const v = healthRoll(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(99);
    }
  });
  it("differs across seeds (not all equal)", () => {
    const set = new Set(["a", "b", "c", "d", "e", "f"].map(healthRoll));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("healthRollRange", () => {
  it("stays within [lo,hi] inclusive", () => {
    for (const k of ["x", "y", "z", "w", "v"]) {
      const v = healthRollRange(k, 3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
    }
  });
  it("is deterministic", () => {
    expect(healthRollRange("k", 1, 100)).toBe(healthRollRange("k", 1, 100));
  });
});

describe("healthRollBasisPoints", () => {
  it("in [0,9999], deterministic", () => {
    expect(healthRollBasisPoints("a")).toBe(healthRollBasisPoints("a"));
    for (const k of ["a", "b", "c", "d"]) {
      const v = healthRollBasisPoints(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10000);
    }
  });
});
