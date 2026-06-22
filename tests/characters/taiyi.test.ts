import { describe, it, expect } from "vitest";
import { courtPhysician } from "../../src/engine/characters/taiyi";

describe("courtPhysician", () => {
  it("确定性：同 seed 同结果", () => {
    expect(courtPhysician(42)).toEqual(courtPhysician(42));
  });
  it("portraitSet 在 official1..official8", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(/^official([1-8])$/.test(courtPhysician(seed).portraitSet)).toBe(true);
    }
  });
  it("name 非空（姓+名 ≥ 2 字）", () => {
    expect(courtPhysician(7).name.length).toBeGreaterThanOrEqual(2);
  });
});
