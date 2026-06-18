import { describe, expect, it } from "vitest";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";

describe("monthOrdinal", () => {
  it("counts months from 元年一月 = 1", () => {
    expect(monthOrdinal(makeGameTime(1, 1, "early"))).toBe(1);
    expect(monthOrdinal(makeGameTime(1, 4, "late"))).toBe(4);
    expect(monthOrdinal(makeGameTime(2, 1, "mid"))).toBe(13);
  });
  it("ignores period (month granularity)", () => {
    expect(monthOrdinal(makeGameTime(1, 3, "early"))).toBe(monthOrdinal(makeGameTime(1, 3, "late")));
  });
});
