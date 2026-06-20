import { describe, expect, it } from "vitest";
import { powerOf } from "../../src/engine/officials/power";
import type { OfficialPost } from "../../src/engine/content/schemas";

const post = (gradeOrder: number): OfficialPost => ({ id: "p", name: "x", grade: "g", gradeOrder });

describe("powerOf", () => {
  it("rises monotonically with gradeOrder", () => {
    expect(powerOf(post(18), "a")).toBeGreaterThan(powerOf(post(6), "a"));
    expect(powerOf(post(6), "a")).toBeGreaterThan(powerOf(post(0), "a"));
  });
  it("stays within 0–100 and is stable per id", () => {
    for (const g of [0, 6, 12, 18]) {
      const v = powerOf(post(g), "x");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(powerOf(post(g), "x")).toBe(v); // deterministic
    }
  });
  it("commoner (gradeOrder 0) is low", () => {
    expect(powerOf(post(0), "x")).toBeLessThanOrEqual(10);
  });
});
