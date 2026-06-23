/**
 * 集成回归：大选日历事件由时间事务统一入口（advanceCandidate）探测置位 pendingDaxuan，
 * 与具体行动路径无关。覆盖 SPEND_AP / SKIP_REMAINDER / travelAndAdvance / resolveTimedAction，
 * 以及「不提前写 resolved flag」「清空后下次推进补触发」与消费语义。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { daxuanAnnounceFlagKey, daxuanDianxuanFlagKey, daxuanDianxuanPromptFor } from "../../src/store/grandSelection";
import type { PendingDaxuan } from "../../src/engine/state/types";

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

/** 任意年份 + 预置 pending（跨年存档场景）。 */
function storeWith(opts: {
  year?: number; month: number; period: "early" | "mid" | "late"; ap?: number;
  flags?: Record<string, boolean>; pending?: PendingDaxuan;
}): GameStore {
  const store = new GameStore();
  store.newGame(db);
  const s = store.getState();
  const year = opts.year ?? 1;
  store.loadState({
    ...s,
    calendar: { ...s.calendar, year, month: opts.month, period: opts.period, dayIndex: dayIndexOf(year, opts.month, opts.period), ap: opts.ap ?? s.calendar.apMax },
    flags: { ...s.flags, ...(opts.flags ?? {}) },
    pendingDaxuan: opts.pending,
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

describe("殿选 enter 事务顺序（扣点失败不丢失）", () => {
  it("AP=0 选前往 → 扣点失败：pending 保留、flag 不写、不解决", () => {
    const store = storeWith({ month: 4, period: "late", ap: 0, flags: { [ANNOUNCE]: true }, pending: { kind: "dianxuan", year: 1 } });
    const r = store.enterDaxuan(db, 1);
    expect(r.ok).toBe(false);
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
    expect(store.getState().flags[DIANXUAN]).toBeFalsy();
  });

  it("AP 充足选前往 → 扣 1AP、置该年 flag、清 pending", () => {
    const store = storeWith({ month: 4, period: "late", ap: 4, flags: { [ANNOUNCE]: true }, pending: { kind: "dianxuan", year: 1 } });
    const r = store.enterDaxuan(db, 1);
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.ap).toBe(3);
    expect(store.getState().flags[DIANXUAN]).toBe(true);
    expect(store.getState().pendingDaxuan).toBeUndefined();
  });

  it("委托 resolveDaxuanDianxuan：原子置该年 flag + 清 pending（不扣点）", () => {
    const store = storeWith({ month: 4, period: "late", flags: { [ANNOUNCE]: true }, pending: { kind: "dianxuan", year: 1 } });
    const apBefore = store.getState().calendar.ap;
    store.resolveDaxuanDianxuan(1);
    expect(store.getState().flags[DIANXUAN]).toBe(true);
    expect(store.getState().pendingDaxuan).toBeUndefined();
    expect(store.getState().calendar.ap).toBe(apBefore); // 未扣点
  });
});

describe("跨年存档：按 pending.year 消费（年份权威）", () => {
  it("年1 announce pending 于年2 加载 → 落年1 flag、不落年2 flag", () => {
    const store = storeWith({ year: 2, month: 5, period: "early", pending: { kind: "announce", year: 1 } });
    store.consumeDaxuanAnnounce(db);
    expect(store.getState().flags[daxuanAnnounceFlagKey(1)]).toBe(true);
    expect(store.getState().flags[daxuanAnnounceFlagKey(2)]).toBeFalsy();
  });

  it("年1 announce pending 于年1四月之后加载 → 消费 announce 并链接年1 dianxuan", () => {
    const store = storeWith({ year: 2, month: 5, period: "early", pending: { kind: "announce", year: 1 } });
    store.consumeDaxuanAnnounce(db);
    expect(store.getState().pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
  });

  it("年1 dianxuan pending 于年2 加载 → prompt 携带年1；解决落年1 flag、清 pending", () => {
    const p = daxuanDianxuanPromptFor(1);
    expect(p.choices.map((c) => (c.action as { year: number }).year)).toEqual([1, 1]);
    const store = storeWith({ year: 2, month: 5, period: "early", flags: { [daxuanAnnounceFlagKey(1)]: true }, pending: { kind: "dianxuan", year: 1 } });
    store.resolveDaxuanDianxuan(1);
    expect(store.getState().flags[daxuanDianxuanFlagKey(1)]).toBe(true);
    expect(store.getState().pendingDaxuan).toBeUndefined();
  });
});

describe("陈旧 pending 调和（不 sticky 阻塞下一大选年）", () => {
  it("announce flag 已置的陈旧 announce pending：consume 调和清除、不重播", () => {
    const store = storeWith({ year: 1, month: 2, period: "early", flags: { [ANNOUNCE]: true }, pending: { kind: "announce", year: 1 } });
    const beats = store.consumeDaxuanAnnounce(db);
    expect(beats).toEqual([]);
    expect(store.getState().pendingDaxuan).toBeUndefined();
  });

  it("陈旧 dianxuan pending 于时间推进时被调和，且不阻塞下一大选年探测", () => {
    // 年4（下一大选年）二月卯时，残留年1 已决的陈旧 dianxuan pending。
    const store = storeWith({ year: 4, month: 2, period: "early", flags: { [daxuanDianxuanFlagKey(1)]: true }, pending: { kind: "dianxuan", year: 1 } });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // → 辰时：先调和陈旧，再探测年4
    expect(store.getState().pendingDaxuan).toEqual({ kind: "announce", year: 4 });
  });
});

describe("殿选解决的完整性不变量（拒绝陈旧/重复/错年点击）", () => {
  it("enterDaxuan 无 pending → 错误；不扣点、state 引用不变", () => {
    const store = storeWith({ month: 4, period: "late", flags: { [ANNOUNCE]: true } }); // 无 pending
    const before = store.getState();
    const r = store.enterDaxuan(db, 1);
    expect(r.ok).toBe(false);
    expect(store.getState()).toBe(before); // 未扣点、未改 state（引用一致）
    expect(store.getState().flags[DIANXUAN]).toBeFalsy();
  });

  it("enterDaxuan 遇 announce pending → 错误；AP 不变、announce pending 保留", () => {
    const store = storeWith({ month: 2, period: "early", pending: { kind: "announce", year: 1 } });
    const before = store.getState();
    expect(store.enterDaxuan(db, 1).ok).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().pendingDaxuan).toEqual({ kind: "announce", year: 1 });
  });

  it("enterDaxuan 错年（pending 为另一年）→ 错误；两年 dianxuan flag 均不写、AP 不变", () => {
    const store = storeWith({ year: 4, month: 4, period: "late", flags: { [daxuanAnnounceFlagKey(4)]: true }, pending: { kind: "dianxuan", year: 4 } });
    const before = store.getState();
    expect(store.enterDaxuan(db, 1).ok).toBe(false); // 错误年份
    expect(store.getState()).toBe(before);
    expect(store.getState().flags[daxuanDianxuanFlagKey(1)]).toBeFalsy();
    expect(store.getState().flags[daxuanDianxuanFlagKey(4)]).toBeFalsy();
  });

  it("enterDaxuan 双击（>=2AP）：仅首次扣点成功，合计只扣 1AP", () => {
    const store = storeWith({ month: 4, period: "late", ap: 4, flags: { [ANNOUNCE]: true }, pending: { kind: "dianxuan", year: 1 } });
    const ap0 = store.getState().calendar.ap;
    const r1 = store.enterDaxuan(db, 1);
    const r2 = store.enterDaxuan(db, 1);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false); // pending 已清 → 第二次无匹配，不再扣点
    expect(store.getState().calendar.ap).toBe(ap0 - 1);
    expect(store.getState().flags[DIANXUAN]).toBe(true);
  });

  it("resolveDaxuanDianxuan 无/不匹配 pending → false；state 引用不变、无无关 flag", () => {
    const store = storeWith({ month: 4, period: "late", flags: { [ANNOUNCE]: true } });
    const before = store.getState();
    expect(store.resolveDaxuanDianxuan(1)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().flags[DIANXUAN]).toBeFalsy();
  });

  it("resolveDaxuanDianxuan 双击：首次 true，再次 false 且无二次副作用（引用不变）", () => {
    const store = storeWith({ month: 4, period: "late", flags: { [ANNOUNCE]: true }, pending: { kind: "dianxuan", year: 1 } });
    expect(store.resolveDaxuanDianxuan(1)).toBe(true);
    const after = store.getState();
    expect(store.resolveDaxuanDianxuan(1)).toBe(false);
    expect(store.getState()).toBe(after);
  });

  it("错年 resolve：pending 为年1，resolve(年2) → false；不写任何 flag、引用不变", () => {
    const store = storeWith({ month: 4, period: "late", flags: { [ANNOUNCE]: true }, pending: { kind: "dianxuan", year: 1 } });
    const before = store.getState();
    expect(store.resolveDaxuanDianxuan(2)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().flags[daxuanDianxuanFlagKey(1)]).toBeFalsy();
    expect(store.getState().flags[daxuanDianxuanFlagKey(2)]).toBeFalsy();
  });

  it("匹配年 pending 但该年 flag 已置（陈旧未调和）→ resolve/enter 均拒绝、引用不变", () => {
    // pending 与 flag 同时存在的边界（陈旧 pending 尚未经时间事务调和）：不变量含未决判定，
    // 不得二次置 flag/扣点；陈旧 pending 留待 advanceCandidate 统一调和。
    const store = storeWith({ month: 4, period: "late", ap: 4, flags: { [ANNOUNCE]: true, [DIANXUAN]: true }, pending: { kind: "dianxuan", year: 1 } });
    const before = store.getState();
    expect(store.resolveDaxuanDianxuan(1)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.enterDaxuan(db, 1).ok).toBe(false); // 不扣点
    expect(store.getState()).toBe(before);
  });
});

/** 满行动点（卯时）：新游戏默认 apMax，从而 slot=0 起步。 */
function store0apMax(): number {
  const s = new GameStore();
  s.newGame(db);
  return s.getState().calendar.apMax;
}
