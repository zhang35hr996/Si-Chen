/**
 * 集成回归：大选日历事件由时间事务统一入口（advanceCandidate）探测置位 pendingDaxuan，
 * 与具体行动路径无关。覆盖 SPEND_AP / SKIP_REMAINDER / travelAndAdvance / resolveTimedAction，
 * 以及「不提前写 resolved flag」「清空后下次推进补触发」与消费语义。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { daxuanAnnounceFlagKey, daxuanDianxuanFlagKey } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const ANNOUNCE = daxuanAnnounceFlagKey(1);
const DIANXUAN = daxuanDianxuanFlagKey(1);

/** 元年（大选年），日历摆到 月/旬，留 ap 点，并可预置 flags；清空 pendingDaxuan。 */
function storeAt(month: number, period: "early" | "mid" | "late", ap: number, flags: Record<string, boolean> = {}): GameStore {
  const store = new GameStore();
  store.newGame(db);
  const s = store.getState();
  store.loadState({
    ...s,
    calendar: { ...s.calendar, month, period, dayIndex: dayIndexOf(s.calendar.year, month, period), ap },
    flags: { ...s.flags, ...flags },
    pendingDaxuan: undefined,
  });
  return store;
}

describe("殿选 prompt 由统一时间入口探测（不依赖行动路径）", () => {
  it("普通 SPEND_AP 越过四月下旬辰时 → pendingDaxuan=dianxuan，且不提前写 flag", () => {
    const store = storeAt(4, "late", store0apMax(), { [ANNOUNCE]: true }); // 卯时(满点)，已报过
    expect(store.getState().pendingDaxuan).toBeUndefined();
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // → 辰时
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
    expect(store.getState().flags[DIANXUAN]).toBeFalsy(); // 未决，flag 不提前写
  });

  it("SKIP_REMAINDER 跳过辰时单槽（到次月）仍补触发", () => {
    const store = storeAt(4, "late", store0apMax(), { [ANNOUNCE]: true }); // 四月下旬卯时
    store.advanceTime(db, { type: "SKIP_REMAINDER" }); // 跳到五月上旬，越过四月下旬辰时
    expect(store.getState().calendar.month).toBe(5);
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
  });

  it("travelAndAdvance 越过节点 → pendingDaxuan=dianxuan", () => {
    const store = storeAt(4, "late", store0apMax(), { [ANNOUNCE]: true });
    store.travelAndAdvance(db, [{ type: "MOVE_TO_LOCATION", locationId: "cining_gong" }], { type: "SPEND_AP", amount: 1 });
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
  });

  it("resolveTimedAction（带行动效果）越过节点 → pendingDaxuan=dianxuan", () => {
    const store = storeAt(4, "late", store0apMax(), { [ANNOUNCE]: true });
    store.resolveTimedAction(db, [{ type: "flag", key: "noop", value: true }], { type: "SPEND_AP", amount: 1 });
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
  });

  it("sticky：已挂起则后续推进不覆盖；清空后下次推进补触发（仍不写 flag）", () => {
    const store = storeAt(4, "late", store0apMax(), { [ANNOUNCE]: true });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
    // 再推进一次：仍保留同一待消费态，flag 仍不写。
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
    expect(store.getState().flags[DIANXUAN]).toBeFalsy();
    // 清空（未决，不写 flag）后下一次推进补触发。
    store.clearPendingDaxuan();
    expect(store.getState().pendingDaxuan).toBeUndefined();
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
    expect(store.getState().flags[DIANXUAN]).toBeFalsy();
  });
});

describe("二月报告同源于统一入口 + 消费语义", () => {
  it("SPEND_AP 越过二月上旬辰时 → pendingDaxuan=announce（flag 不提前写）", () => {
    const store = storeAt(2, "early", store0apMax()); // 卯时，未报
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // → 辰时
    expect(store.getState().pendingDaxuan).toEqual({ kind: "announce", year: 1 });
    expect(store.getState().flags[ANNOUNCE]).toBeFalsy();
  });

  it("consumeDaxuanAnnounce：原子落 flag + 清待消费 + 返回节拍", () => {
    const store = storeAt(2, "early", store0apMax());
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    const beats = store.consumeDaxuanAnnounce(db);
    expect(beats.length).toBeGreaterThan(0);
    expect(store.getState().flags[ANNOUNCE]).toBe(true);
    expect(store.getState().pendingDaxuan).toBeUndefined();
  });

  it("clearPendingDaxuan 清除待消费态", () => {
    const store = storeAt(2, "early", store0apMax());
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().pendingDaxuan).not.toBeUndefined();
    store.clearPendingDaxuan();
    expect(store.getState().pendingDaxuan).toBeUndefined();
  });

  it("跳过整个二—四月：consume announce 后立即续上 dianxuan", () => {
    const store = storeAt(4, "late", store0apMax()); // 未报、四月已到点
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // → 辰时；announce 优先
    expect(store.getState().pendingDaxuan).toEqual({ kind: "announce", year: 1 });
    store.consumeDaxuanAnnounce(db);
    expect(store.getState().flags[ANNOUNCE]).toBe(true);
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 }); // 续上殿选
    expect(store.getState().flags[DIANXUAN]).toBeFalsy();
  });
});

/** 满行动点（卯时）：新游戏默认 apMax，从而 slot=0 起步。 */
function store0apMax(): number {
  const s = new GameStore();
  s.newGame(db);
  return s.getState().calendar.apMax;
}
