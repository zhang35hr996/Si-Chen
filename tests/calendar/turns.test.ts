import { describe, expect, it } from "vitest";
import {
  addTurns,
  dayIndexOf,
  fromTurnIndex,
  makeGameTime,
  toTurnIndex,
} from "../../src/engine/calendar/time";

describe("turn-index helpers (绝对旬序号)", () => {
  it("toTurnIndex 即 dayIndex；元年一月上旬 = 0", () => {
    expect(toTurnIndex(makeGameTime(1, 1, "early"))).toBe(0);
    expect(toTurnIndex(makeGameTime(1, 1, "mid"))).toBe(1);
    expect(toTurnIndex(makeGameTime(1, 1, "late"))).toBe(2);
    expect(toTurnIndex(makeGameTime(1, 2, "early"))).toBe(3);
  });

  it("fromTurnIndex 是 dayIndexOf 的逆", () => {
    for (let i = 0; i < 200; i++) {
      const t = fromTurnIndex(i);
      expect(dayIndexOf(t.year, t.month, t.period)).toBe(i);
      expect(t.dayIndex).toBe(i);
    }
  });

  it("addTurns 一个月(3旬)：五月中旬 → 六月中旬", () => {
    const may_mid = makeGameTime(3, 5, "mid");
    const after = addTurns(may_mid, 3);
    expect(after).toMatchObject({ year: 3, month: 6, period: "mid" });
  });

  it("addTurns 跨年：十二月下旬 + 1旬 → 次年一月上旬", () => {
    const dec_late = makeGameTime(2, 12, "late");
    expect(addTurns(dec_late, 1)).toMatchObject({ year: 3, month: 1, period: "early" });
  });

  it("半年=18旬、一年=36旬、三月=9旬 的位移正确", () => {
    const start = makeGameTime(1, 1, "early");
    expect(addTurns(start, 9)).toMatchObject({ year: 1, month: 4, period: "early" });
    expect(addTurns(start, 18)).toMatchObject({ year: 1, month: 7, period: "early" });
    expect(addTurns(start, 36)).toMatchObject({ year: 2, month: 1, period: "early" });
  });

  it("fromTurnIndex 拒绝负数", () => {
    expect(() => fromTurnIndex(-1)).toThrow();
  });
});
