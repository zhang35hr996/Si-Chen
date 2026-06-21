import { describe, expect, it } from "vitest";
import { createCalendar, isMorningSlot, isAfternoonSlot, MORNING_SLOT, AFTERNOON_SLOT } from "../../src/engine/calendar/time";

describe("时间槽辅助", () => {
  it("上午=辰(slot1)、下午=申(slot2)", () => {
    expect([MORNING_SLOT, AFTERNOON_SLOT]).toEqual([1, 2]);
    const cal = createCalendar({ apMax: 6 }); // ap=6 → slot0
    const morning = { ...cal, ap: 5 }; // slot1
    const afternoon = { ...cal, ap: 4 }; // slot2
    expect(isMorningSlot(morning)).toBe(true);
    expect(isMorningSlot(afternoon)).toBe(false);
    expect(isAfternoonSlot(afternoon)).toBe(true);
    expect(isAfternoonSlot(cal)).toBe(false); // slot0
  });
});
