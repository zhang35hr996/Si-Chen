import { describe, expect, it } from "vitest";
import { ageOver35, presetAge, heirAge, dynamicConsortAge } from "../../src/engine/characters/aging";

describe("aging", () => {
  it("ageOver35 floors at 0", () => {
    expect(ageOver35(20)).toBe(0);
    expect(ageOver35(35)).toBe(0);
    expect(ageOver35(52)).toBe(17);
  });
  it("presetAge advances with game year", () => {
    expect(presetAge(18, 1)).toBe(18); // 元年
    expect(presetAge(18, 3)).toBe(20);
    expect(presetAge(52, 5)).toBe(56);
  });
  it("heirAge uses birth year, not game start", () => {
    expect(heirAge({ year: 3 }, { year: 3 })).toBe(0);
    expect(heirAge({ year: 3 }, { year: 7 })).toBe(4);
  });
  it("dynamicConsortAge uses entry year", () => {
    expect(dynamicConsortAge(16, 4, 4)).toBe(16);
    expect(dynamicConsortAge(16, 4, 7)).toBe(19);
  });
});
