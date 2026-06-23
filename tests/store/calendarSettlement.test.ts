/**
 * 统一日历边界结算（Phase 2 review §1）：所有推进日历的入口（advanceTime / resolveTimedAction /
 * travelAndAdvance / resolveEvent）必须跑同一套结算——事件 apCost 跨年/跨月不得漏跑增龄/死亡/
 * 告老/健康/大选/禁足；失败整体回滚。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { buildOfficialYearlyTick } from "../../src/store/officialsLifecycleTick";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed");
const db = content.value;

const AP_EVENT = "ev_chaohui"; // apCost 1
const apCost = db.events[AP_EVENT]!.apCost;

/** 把状态摆到「元年十二月下旬、仅余 1 AP」，使一次 apCost/SPEND_AP 滚入次年正月。 */
function atYearEnd(seed = 1): GameState {
  const s = createNewGameState(db, seed);
  return {
    ...s,
    calendar: { ...s.calendar, year: 1, month: 12, period: "late", dayIndex: dayIndexOf(1, 12, "late"), ap: apCost },
  };
}
const agesOf = (s: GameState) => Object.fromEntries(Object.values(s.officials).map((o) => [o.id, o.age]));

describe("event apCost rollover runs the same boundary settlement", () => {
  it("apCost event rolling 十二月下旬 → 正月 ages officials exactly once", () => {
    const store = new GameStore();
    store.loadState(atYearEnd(9));
    const before = agesOf(store.getState());
    const r = store.resolveEvent(db, AP_EVENT, []);
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.year).toBe(2);
    for (const o of Object.values(store.getState().officials)) {
      expect(o.age).toBe(o.status === "dead" ? before[o.id]! : before[o.id]! + 1);
    }
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });

  it("resolveEvent year-cross matches a direct advanceTime year-cross (officials/history/pending)", () => {
    const pre = atYearEnd(5);
    const viaEvent = new GameStore(); viaEvent.loadState(pre);
    expect(viaEvent.resolveEvent(db, AP_EVENT, []).ok).toBe(true);
    const viaTime = new GameStore(); viaTime.loadState(pre);
    expect(viaTime.advanceTime(db, { type: "SPEND_AP", amount: apCost }).ok).toBe(true);

    expect(viaEvent.getState().officials).toEqual(viaTime.getState().officials);
    expect(viaEvent.getState().officialHistory).toEqual(viaTime.getState().officialHistory);
    expect(viaEvent.getState().pendingRetirements).toEqual(viaTime.getState().pendingRetirements);
    expect(viaEvent.getState().familyMembers).toEqual(viaTime.getState().familyMembers);
    // 与纯年度 tick 一致
    const ref = buildOfficialYearlyTick(viaTime.getState(), db, viaTime.getState().calendar);
    // ref 会再 tick 一次（第三年）→ 仅用于反向确认上面这次确实等同一次 tick：officials 数量一致
    expect(Object.keys(ref.officials).length).toBe(Object.keys(viaTime.getState().officials).length);
  });

  it("crossing a normal month does NOT age officials (no year tick)", () => {
    const s = createNewGameState(db, 1);
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 3, period: "late", dayIndex: dayIndexOf(1, 3, "late"), ap: 1 } });
    const before = agesOf(store.getState());
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.month).toBe(4); // 跨月
    expect(agesOf(store.getState())).toEqual(before); // 未跨年 → 不增龄
  });

  it("does not double-tick: a second action in January does not re-age", () => {
    const store = new GameStore();
    store.loadState(atYearEnd(3));
    expect(store.advanceTime(db, { type: "SPEND_AP", amount: apCost }).ok).toBe(true); // → 次年正月，tick 一次
    const afterFirst = agesOf(store.getState());
    expect(store.advanceTime(db, { type: "SPEND_AP", amount: 1 }).ok).toBe(true); // 正月内再行动
    expect(agesOf(store.getState())).toEqual(afterFirst); // 不重复 tick
  });
});

describe("settlement failure rolls back the whole transaction", () => {
  it("a failing boundary settlement leaves event/AP/eventLog/state untouched", () => {
    // 构造一条「已到期且未记史」的禁足，指向不存在的角色 → 期满 sweep 的 lift_confinement 漏斗拒绝
    // → settleCalendarAdvance 失败 → resolveEvent 整体回滚。
    const base = atYearEnd(1);
    const broken: GameState = {
      ...base,
      statusEffects: [
        ...base.statusEffects,
        {
          id: "se_ghost", kind: "confinement", characterId: "ghost_char",
          startTurn: 0, endTurnExclusive: 1, imposedAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, imposedBy: "emperor",
        },
      ],
    };
    const store = new GameStore();
    store.loadState(broken);
    const snapshot = JSON.stringify(store.getState());
    const r = store.resolveEvent(db, AP_EVENT, []);
    expect(r.ok).toBe(false);
    // 全回滚：state 逐字节不变（AP 未扣、eventLog 未追加、日历未推进）。
    expect(JSON.stringify(store.getState())).toBe(snapshot);
    expect(store.getState().eventLog.some((e) => e.eventId === AP_EVENT)).toBe(false);
  });
});
