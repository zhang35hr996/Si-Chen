import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildDaxuanAnnounce, buildDaxuanDianxuanPrompt } from "../../src/store/grandSelection";
import { MORNING_SLOT, dayIndexOf } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** 把日历摆到指定 月/旬/slot（slot = apMax - ap）；dayIndex 随月/旬一并校正（与真实状态一致）。 */
function at(s = createNewGameState(db), month: number, period: "early" | "mid" | "late", slot: number) {
  const cal = s.calendar;
  return {
    ...s,
    calendar: { ...cal, month, period, dayIndex: dayIndexOf(cal.year, month, period), ap: cal.apMax - slot },
  };
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

  it("仍在四月下旬辰时之前 → null（卯时尚早）", () => {
    const before = at(createNewGameState(db), 4, "late", 0); // 卯时，早于辰时
    expect(buildDaxuanDianxuanPrompt(db, before)).toBeNull();
    const earlierPeriod = at(createNewGameState(db), 4, "mid", MORNING_SLOT);
    expect(buildDaxuanDianxuanPrompt(db, earlierPeriod)).toBeNull();
    const earlierMonth = at(createNewGameState(db), 3, "late", MORNING_SLOT);
    expect(buildDaxuanDianxuanPrompt(db, earlierMonth)).toBeNull();
  });

  it("错过辰时窗口后仍在大选年内 → 补触发（不永久丢失）", () => {
    // 同一行动日更晚的时辰
    const sameDayLater = at(createNewGameState(db), 4, "late", MORNING_SLOT + 1);
    expect(buildDaxuanDianxuanPrompt(db, sameDayLater)).not.toBeNull();
    // 之后的月份仍在大选年
    const laterMonth = at(createNewGameState(db), 6, "early", 0);
    expect(buildDaxuanDianxuanPrompt(db, laterMonth)).not.toBeNull();
    // 已决则不再补触发
    const resolved = { ...laterMonth, flags: { ...laterMonth.flags, "daxuan:dianxuan:1": true } };
    expect(buildDaxuanDianxuanPrompt(db, resolved)).toBeNull();
  });
});
