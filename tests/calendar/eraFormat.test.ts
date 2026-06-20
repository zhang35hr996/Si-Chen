import { describe, it, expect } from "vitest";
import { formatYear, formatGameTime, createCalendar, advanceActionDay } from "../../src/engine/calendar/time";

describe("年号格式化", () => {
  it("formatYear 带年号：元年/二年", () => {
    expect(formatYear(1, "甘露")).toBe("甘露元年");
    expect(formatYear(2, "甘露")).toBe("甘露二年");
  });
  it("formatYear 空年号退回原行为", () => {
    expect(formatYear(1)).toBe("元年");
    expect(formatYear(3)).toBe("三年");
  });
  it("formatGameTime 从 calendar.eraName 自动带年号", () => {
    const cal = createCalendar({ eraName: "甘露" });
    expect(formatGameTime(cal)).toBe("甘露元年一月上旬");
  });
  it("advanceActionDay 保留年号", () => {
    const cal = createCalendar({ eraName: "甘露" });
    expect(advanceActionDay(cal).eraName).toBe("甘露");
  });
  it("无 eraName 的 GameTime 不带年号", () => {
    expect(formatGameTime({ year: 1, month: 1, period: "early", dayIndex: 0 })).toBe("元年一月上旬");
  });
});
