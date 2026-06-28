/**
 * maybeScheduleBirthdayRitual 纯函数测试：
 *   - 八月上旬到达时设 pending flag + 年度 guard
 *   - 幂等（同年不重复）
 *   - catch-up（八月中旬后到达也触发）
 *   - 七月不触发
 *   - 下一年重新触发
 */
import { describe, expect, it } from "vitest";
import { maybeScheduleBirthdayRitual } from "../../src/engine/events/ritualSchedule";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { FlagValue, GameState } from "../../src/engine/state/types";

const db = loadRealContent();

function stateAt(year: number, month: number, period: "early" | "mid" | "late", flags: Record<string, FlagValue> = {}): GameState {
  const base = createNewGameState(db);
  const cal = makeGameTime(year, month, period);
  return { ...base, calendar: { ...base.calendar, ...cal }, flags: { ...base.flags, ...flags } };
}

describe("maybeScheduleBirthdayRitual", () => {
  it("triggers on 八月上旬 of year 1", () => {
    const state = stateAt(1, 8, "early");
    const next = maybeScheduleBirthdayRitual(state);
    expect(next.flags["ritual_birthday_pending"]).toBe(true);
    expect(next.flags["ritual_birthday_scheduled_1"]).toBe(true);
  });

  it("is idempotent: does not re-trigger if already scheduled", () => {
    const state = stateAt(1, 8, "early", { ritual_birthday_scheduled_1: true, ritual_birthday_pending: true });
    const next = maybeScheduleBirthdayRitual(state);
    expect(next).toBe(state); // exact same reference
  });

  it("catch-up: triggers on 八月中旬 if not yet scheduled", () => {
    const state = stateAt(1, 8, "mid");
    const next = maybeScheduleBirthdayRitual(state);
    expect(next.flags["ritual_birthday_pending"]).toBe(true);
  });

  it("catch-up: triggers on 九月 if not yet scheduled", () => {
    const state = stateAt(1, 9, "early");
    const next = maybeScheduleBirthdayRitual(state);
    expect(next.flags["ritual_birthday_pending"]).toBe(true);
    expect(next.flags["ritual_birthday_scheduled_1"]).toBe(true);
  });

  it("does not trigger before 八月上旬", () => {
    const state = stateAt(1, 7, "late");
    const next = maybeScheduleBirthdayRitual(state);
    expect(next).toBe(state);
    expect(next.flags["ritual_birthday_pending"]).toBeFalsy();
  });

  it("triggers again for year 2 (cross-year reset)", () => {
    // Year 1 already resolved
    const state = stateAt(2, 8, "early", {
      ritual_birthday_scheduled_1: true,
      ritual_birthday_pending: false,
    });
    const next = maybeScheduleBirthdayRitual(state);
    expect(next.flags["ritual_birthday_pending"]).toBe(true);
    expect(next.flags["ritual_birthday_scheduled_2"]).toBe(true);
    // year 1 guard unaffected
    expect(next.flags["ritual_birthday_scheduled_1"]).toBe(true);
  });

  it("does not touch other flags", () => {
    const state = stateAt(1, 8, "early", { some_other_flag: true });
    const next = maybeScheduleBirthdayRitual(state);
    expect(next.flags["some_other_flag"]).toBe(true);
  });
});
