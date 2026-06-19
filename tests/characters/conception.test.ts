import { describe, expect, it } from "vitest";
import { conceives } from "../../src/engine/characters/conception";

describe("conceives (deterministic)", () => {
  it("is stable for identical inputs", () => {
    const a = conceives(1, 5, "lu_huaijin", 30);
    const b = conceives(1, 5, "lu_huaijin", 30);
    expect(a).toBe(b);
  });
  it("chance 0 never conceives", () => {
    for (const day of [1, 2, 3, 50]) expect(conceives(7, day, "xu_qinghuan", 0)).toBe(false);
  });
  it("chance 100 always conceives", () => {
    for (const day of [1, 2, 3, 50]) expect(conceives(7, day, "xu_qinghuan", 100)).toBe(true);
  });
  it("varies across inputs (not constant)", () => {
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => conceives(1, d, "xu_qinghuan", 50));
    expect(new Set(results).size).toBe(2);
  });
});
