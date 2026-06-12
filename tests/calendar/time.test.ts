import { describe, expect, it } from "vitest";
import {
  advanceActionDay,
  calendarInvariantViolation,
  chineseNumeral,
  createCalendar,
  dayIndexOf,
  formatAp,
  formatGameTime,
  makeGameTime,
  toGameTime,
  type CalendarState,
  type MonthPeriod,
} from "../../src/engine/calendar/time";

describe("calendar core", () => {
  it("createCalendar defaults to 元年一月上旬 with AP 5/5", () => {
    const cal = createCalendar();
    expect(cal).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0, ap: 5, apMax: 5 });
  });

  it.each([
    [1, 1, "early", 0],
    [1, 1, "late", 2],
    [1, 2, "early", 3],
    [1, 12, "late", 35],
    [2, 1, "early", 36],
    [3, 7, "mid", 2 * 36 + 6 * 3 + 1],
  ] as const)("dayIndexOf(%i年%i月 %s) = %i", (year, month, period, expected) => {
    expect(dayIndexOf(year, month, period as MonthPeriod)).toBe(expected);
  });

  it("toGameTime strips AP bookkeeping from the clock", () => {
    const cal = createCalendar({ year: 2, month: 5, period: "mid" });
    const t = toGameTime(cal);
    expect(t).toEqual({ year: 2, month: 5, period: "mid", dayIndex: dayIndexOf(2, 5, "mid") });
    expect("ap" in t).toBe(false);
    expect("apMax" in t).toBe(false);
  });
});

describe("action-day rollover", () => {
  const at = (year: number, month: number, period: MonthPeriod): CalendarState => ({
    ...makeGameTime(year, month, period),
    ap: 0,
    apMax: 5,
  });

  it.each([
    // [from, expected]
    [at(1, 1, "early"), { year: 1, month: 1, period: "mid" }],
    [at(1, 1, "mid"), { year: 1, month: 1, period: "late" }],
    [at(1, 1, "late"), { year: 1, month: 2, period: "early" }],
    [at(1, 11, "late"), { year: 1, month: 12, period: "early" }],
    [at(1, 12, "late"), { year: 2, month: 1, period: "early" }],
    [at(9, 12, "late"), { year: 10, month: 1, period: "early" }],
  ] as const)("advances %o", (from, expected) => {
    const next = advanceActionDay(from);
    expect(next).toMatchObject(expected);
    expect(next.ap).toBe(5); // AP refills
    expect(next.dayIndex).toBe(from.dayIndex + 1); // dayIndex is strictly monotonic
  });
});

describe("invariant check", () => {
  it("accepts every constructed state", () => {
    let cal = createCalendar();
    for (let i = 0; i < 40; i++) {
      expect(calendarInvariantViolation(cal)).toBeNull();
      cal = advanceActionDay({ ...cal, ap: 0 });
    }
  });

  it.each([
    [{ month: 13 }, "month"],
    [{ month: 0 }, "month"],
    [{ year: 0 }, "year"],
    [{ ap: -1 }, "ap"],
    [{ ap: 6 }, "ap"],
    [{ apMax: 0 }, "apMax"],
    [{ dayIndex: 999 }, "dayIndex"],
    [{ period: "dawn" as MonthPeriod }, "period"],
  ] as const)("rejects %o", (patch, fragment) => {
    const broken = { ...createCalendar(), ...patch } as CalendarState;
    expect(calendarInvariantViolation(broken)).toContain(fragment);
  });
});

describe("Chinese formatting", () => {
  it.each([
    [1, "一"],
    [9, "九"],
    [10, "十"],
    [11, "十一"],
    [12, "十二"],
    [20, "二十"],
    [21, "二十一"],
    [99, "九十九"],
  ] as const)("chineseNumeral(%i) = %s", (n, expected) => {
    expect(chineseNumeral(n)).toBe(expected);
  });

  it("rejects out-of-range numerals", () => {
    expect(() => chineseNumeral(0)).toThrow(RangeError);
    expect(() => chineseNumeral(100)).toThrow(RangeError);
  });

  it.each([
    [makeGameTime(1, 1, "early"), "元年一月上旬"],
    [makeGameTime(1, 11, "mid"), "元年十一月中旬"],
    [makeGameTime(2, 12, "late"), "二年十二月下旬"],
    [makeGameTime(10, 3, "early"), "十年三月上旬"],
  ] as const)("formatGameTime → %s", (time, expected) => {
    expect(formatGameTime(time)).toBe(expected);
  });

  it("formatAp renders 行动点：n/max", () => {
    expect(formatAp(createCalendar())).toBe("行动点：5/5");
    expect(formatAp({ ...createCalendar(), ap: 2 })).toBe("行动点：2/5");
  });
});
