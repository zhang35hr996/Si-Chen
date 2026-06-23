import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildDaxuanAnnounce, buildDaxuanDianxuanPrompt, nextPendingDaxuan } from "../../src/store/grandSelection";
import { daxuanAnnounceFlagKey, daxuanDianxuanFlagKey } from "../../src/store/grandSelection";
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

/** 指定年份的新游戏状态（用于跨年/非大选年断言）。 */
function withYear(year: number) {
  const s = createNewGameState(db);
  return { ...s, calendar: { ...s.calendar, year } };
}

describe("二月报告 buildDaxuanAnnounce（到点补触发）", () => {
  it("大选年二月上旬辰时出报告；已报过/非大选年 → null", () => {
    const s = at(createNewGameState(db), 2, "early", MORNING_SLOT); // 元年=大选年
    const r = buildDaxuanAnnounce(db, s);
    expect(r).not.toBeNull();
    expect(r!.effects.some((e) => e.type === "flag" && e.key === "daxuan:announce:1")).toBe(true);
    expect(r!.beats[0]!.lines.length).toBeGreaterThan(0);

    const asked = { ...s, flags: { ...s.flags, "daxuan:announce:1": true } };
    expect(buildDaxuanAnnounce(db, asked)).toBeNull();

    const notYear = { ...s, calendar: { ...s.calendar, year: 2 } };
    expect(buildDaxuanAnnounce(db, notYear)).toBeNull();
  });

  it("二月上旬辰时之前 → null（卯时尚早 / 更早月份）", () => {
    const maoSameDay = at(createNewGameState(db), 2, "early", 0); // 卯时，早于辰时
    expect(buildDaxuanAnnounce(db, maoSameDay)).toBeNull();
    const earlierMonth = at(createNewGameState(db), 1, "late", MORNING_SLOT);
    expect(buildDaxuanAnnounce(db, earlierMonth)).toBeNull();
  });

  it("错过辰时窗口后仍在大选年内 → 补触发（不永久丢失）", () => {
    const sameDayLater = at(createNewGameState(db), 2, "early", MORNING_SLOT + 1); // 同日更晚时辰
    expect(buildDaxuanAnnounce(db, sameDayLater)).not.toBeNull();
    const laterPeriod = at(createNewGameState(db), 2, "mid", 0); // 后续旬
    expect(buildDaxuanAnnounce(db, laterPeriod)).not.toBeNull();
    const laterMonth = at(createNewGameState(db), 3, "early", MORNING_SLOT); // 后续月
    expect(buildDaxuanAnnounce(db, laterMonth)).not.toBeNull();
    // 已报则不再补触发（不重复）。
    const reported = { ...laterMonth, flags: { ...laterMonth.flags, "daxuan:announce:1": true } };
    expect(buildDaxuanAnnounce(db, reported)).toBeNull();
  });

  it("大选年结束后不残留（次年非大选年，纵在二月之后亦 null）", () => {
    const nextYear = at(withYear(2), 5, "early", MORNING_SLOT);
    expect(buildDaxuanAnnounce(db, nextYear)).toBeNull();
  });

  it("正常时序：二月报告早于四月殿选 prompt 到点", () => {
    // 三月：报告已到点（补触发），殿选尚未到点 → null。
    const march = at(createNewGameState(db), 3, "early", MORNING_SLOT);
    expect(buildDaxuanAnnounce(db, march)).not.toBeNull();
    expect(buildDaxuanDianxuanPrompt(db, march)).toBeNull();
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

describe("nextPendingDaxuan（统一入口探测的待消费事件）", () => {
  const announced = (s: ReturnType<typeof at>) => ({ ...s, flags: { ...s.flags, [daxuanAnnounceFlagKey(1)]: true } });

  it("二月到点前 → null", () => {
    expect(nextPendingDaxuan(at(createNewGameState(db), 1, "late", MORNING_SLOT))).toBeNull();
  });

  it("二月到点、未报 → announce（优先）", () => {
    expect(nextPendingDaxuan(at(createNewGameState(db), 2, "early", MORNING_SLOT))).toEqual({ kind: "announce", year: 1 });
  });

  it("已报、四月前 → null", () => {
    expect(nextPendingDaxuan(announced(at(createNewGameState(db), 3, "early", MORNING_SLOT)))).toBeNull();
  });

  it("已报、四月到点未决 → dianxuan", () => {
    expect(nextPendingDaxuan(announced(at(createNewGameState(db), 4, "late", MORNING_SLOT)))).toEqual({ kind: "dianxuan", year: 1 });
  });

  it("两 flag 皆置 → null", () => {
    const both = announced(at(createNewGameState(db), 4, "late", MORNING_SLOT));
    expect(nextPendingDaxuan({ ...both, flags: { ...both.flags, [daxuanDianxuanFlagKey(1)]: true } })).toBeNull();
  });

  it("二月与四月同时到点（未报且过四月）→ announce 优先补出", () => {
    // 跳过二月直到四月下旬：announce 仍未报、dianxuan 亦到点。
    expect(nextPendingDaxuan(at(createNewGameState(db), 4, "late", MORNING_SLOT))).toEqual({ kind: "announce", year: 1 });
  });

  it("非大选年 → null", () => {
    expect(nextPendingDaxuan(at(withYear(2), 4, "late", MORNING_SLOT))).toBeNull();
  });
});
