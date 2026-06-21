import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildDaxuanAnnounce, buildDaxuanDianxuanPrompt } from "../../src/store/grandSelection";
import { MORNING_SLOT } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** 把日历摆到指定 月/旬/slot（slot = apMax - ap）。 */
function at(s = createNewGameState(db), month: number, period: "early" | "mid" | "late", slot: number) {
  return { ...s, calendar: { ...s.calendar, month, period, ap: s.calendar.apMax - slot } };
}

describe("二月报告 buildDaxuanAnnounce", () => {
  it("大选年二月上旬辰时出报告；非大选年/已报过 → null", () => {
    const s = at(createNewGameState(db), 2, "early", MORNING_SLOT); // 元年=大选年
    const r = buildDaxuanAnnounce(db, s);
    expect(r).not.toBeNull();
    expect(r!.effects.some((e) => e.type === "flag" && e.key === "daxuan:announce:1")).toBe(true);
    expect(r!.beats[0]!.lines.length).toBeGreaterThan(0);

    const asked = { ...s, flags: { ...s.flags, "daxuan:announce:1": true } };
    expect(buildDaxuanAnnounce(db, asked)).toBeNull();

    const notYear = { ...s, calendar: { ...s.calendar, year: 2 } };
    expect(buildDaxuanAnnounce(db, notYear)).toBeNull();

    const wrongMonth = at(createNewGameState(db), 3, "early", MORNING_SLOT);
    expect(buildDaxuanAnnounce(db, wrongMonth)).toBeNull();
  });
});

describe("四月殿选 prompt buildDaxuanDianxuanPrompt", () => {
  it("大选年四月下旬辰时出 prompt（两选项）；已决/非大选年 → null", () => {
    const s = at(createNewGameState(db), 4, "late", MORNING_SLOT);
    const p = buildDaxuanDianxuanPrompt(db, s);
    expect(p).not.toBeNull();
    expect(p!.choices.map((c) => c.action.type).sort()).toEqual(["daxuanDelegate", "daxuanEnter"]);

    const done = { ...s, flags: { ...s.flags, "daxuan:dianxuan:1": true } };
    expect(buildDaxuanDianxuanPrompt(db, done)).toBeNull();

    const notYear = { ...s, calendar: { ...s.calendar, year: 3 } };
    expect(buildDaxuanDianxuanPrompt(db, notYear)).toBeNull();
  });
});
