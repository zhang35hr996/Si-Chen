import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { canSummon, passionAllowed } from "../../src/store/bedchamber";
import { monthOrdinal } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("availableFromMonth gates 侍寝", () => {
  it("blocks before the unlock month, allows on/after", () => {
    const s = createNewGameState(db); // 元年一月
    const unlock = monthOrdinal({ year: s.calendar.year, month: 5 });
    const id = "xiunan_1_0";
    const blocked = { ...s, standing: { ...s.standing, [id]: { rank: "gengyi", favor: 10, peakFavor: 10, availableFromMonth: unlock } } };
    expect(canSummon(blocked, id)).toBe(false);
    expect(passionAllowed(blocked, id)).toBe(false);

    const inMay = { ...blocked, calendar: { ...blocked.calendar, month: 5, period: "early" as const } };
    expect(canSummon(inMay, id)).toBe(true);
    expect(passionAllowed(inMay, id)).toBe(true);
  });
});
