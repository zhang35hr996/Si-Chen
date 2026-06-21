import { describe, expect, it } from "vitest";
import { compareGameTime, makeGameTime } from "../../src/engine/calendar/time";

describe("compareGameTime", () => {
  it("早于→负，晚于→正，相等→0（按 dayIndex）", () => {
    const early = makeGameTime(1, 1, "early");
    const mid = makeGameTime(1, 1, "mid");
    const nextYear = makeGameTime(2, 1, "early");
    expect(compareGameTime(early, mid)).toBeLessThan(0);
    expect(compareGameTime(nextYear, mid)).toBeGreaterThan(0);
    expect(compareGameTime(early, early)).toBe(0);
  });

  it("可用于排序（升序）", () => {
    const times = [makeGameTime(2, 3, "late"), makeGameTime(1, 1, "early"), makeGameTime(1, 12, "mid")];
    const sorted = [...times].sort(compareGameTime).map((t) => t.dayIndex);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });
});
