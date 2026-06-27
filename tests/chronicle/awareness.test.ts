import { describe, expect, it } from "vitest";
import { canKnowEvent } from "../../src/engine/chronicle/awareness";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent, GameState } from "../../src/engine/state/types";

/** now = 元年八月上旬，便于让「事发→后入宫」「未来事件」都落在合法时间线上。 */
function nowState(): GameState {
  return createInitialState({ calendar: { month: 8 } });
}
const entered = (m: number) => ({ rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, m, "early") });
function evt(over: Partial<CourtEvent> = {}): CourtEvent {
  return {
    id: "evt_000001", type: "rank_changed",
    occurredAt: makeGameTime(1, 3, "mid"), // 元年三月（过去，相对 now=八月）
    participants: [], payload: {},
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 50, retention: "slow", tags: [],
    ...over,
  };
}

describe("canKnowEvent", () => {
  it("未知角色（无 standing）一律不知道", () => {
    const s = nowState();
    expect(canKnowEvent(s, "ghost", evt())).toBe(false);
    expect(canKnowEvent(s, "ghost", evt({ publicity: { scope: "realm", persistence: "institutional" } }))).toBe(false);
  });

  it("circle：仅白名单", () => {
    const s = nowState();
    s.standing["a"] = entered(1);
    s.standing["b"] = entered(1);
    const e = evt({ publicity: { scope: "circle", circleIds: ["a"] } });
    expect(canKnowEvent(s, "a", e)).toBe(true);
    expect(canKnowEvent(s, "b", e)).toBe(false);
  });

  it("palace + contemporaneous：事发后入宫的新人不知道", () => {
    const s = nowState();
    s.standing["veteran"] = entered(1);
    s.standing["newcomer"] = entered(6); // 三月事件之后入宫
    expect(canKnowEvent(s, "veteran", evt())).toBe(true);
    expect(canKnowEvent(s, "newcomer", evt())).toBe(false);
  });

  it("palace + institutional：事发后入宫的新人也知道（宫史）", () => {
    const s = nowState();
    s.standing["newcomer"] = entered(6);
    const inst = evt({ type: "heir_died", publicity: { scope: "palace", persistence: "institutional" } });
    expect(canKnowEvent(s, "newcomer", inst)).toBe(true);
  });

  it("palace：无 palaceEnteredAt（官员等）不知道宫内事", () => {
    const s = nowState();
    s.standing["official_x"] = { rank: "shangshu", favor: 50, peakFavor: 50 };
    expect(canKnowEvent(s, "official_x", evt())).toBe(false);
  });

  it("尚未入宫的未来角色：对所有 scope 都不知情（含 circle / realm）", () => {
    const s = nowState(); // now = 元年八月
    s.standing["future"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(2, 1, "early") }; // 明年入宫
    expect(canKnowEvent(s, "future", evt({ type: "heir_died", publicity: { scope: "palace", persistence: "institutional" } }))).toBe(false);
    expect(canKnowEvent(s, "future", evt({ publicity: { scope: "circle", circleIds: ["future"] } }))).toBe(false);
    expect(canKnowEvent(s, "future", evt({ publicity: { scope: "realm", persistence: "institutional" } }))).toBe(false);
  });

  it("未来事件：谁都不知道（occurredAt > now）", () => {
    const s = nowState(); // now = 元年八月
    s.standing["a"] = entered(1);
    const future = evt({ occurredAt: makeGameTime(1, 12, "late") }); // 年底，晚于八月
    expect(canKnowEvent(s, "a", future)).toBe(false);
    expect(canKnowEvent(s, "a", evt({ occurredAt: makeGameTime(1, 12, "late"), publicity: { scope: "realm", persistence: "institutional" } }))).toBe(false);
  });

  it("realm + institutional：在场者知道", () => {
    const s = nowState();
    s.standing["a"] = entered(1);
    expect(canKnowEvent(s, "a", evt({ publicity: { scope: "realm", persistence: "institutional" } }))).toBe(true);
  });
});
