import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { applyBatch, applyCommand } from "../../src/engine/state/reducer";
import type { GameState } from "../../src/engine/state/types";

const freshState = (): GameState => createInitialState();

const expectOk = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
};

const expectErr = <T extends { ok: boolean }>(r: T): Extract<T, { ok: false }> => {
  expect(r.ok).toBe(false);
  return r as Extract<T, { ok: false }>;
};

describe("SKIP_REMAINDER", () => {
  it("jumps straight to the next 旬 morning regardless of remaining AP", () => {
    const noon = expectOk(applyCommand(freshState(), { type: "SPEND_AP", amount: 3 })).value.state; // ap 2, 上旬
    const r = expectOk(applyCommand(noon, { type: "SKIP_REMAINDER" }));
    expect(r.value.rolledOver).toBe(true);
    expect(r.value.state.calendar).toMatchObject({ period: "mid", ap: 5, month: 1, year: 1 });
  });

  it("rolls 下旬 into the next month", () => {
    const state = { ...freshState() };
    const late = { ...state, calendar: { ...state.calendar, period: "late" as const, dayIndex: 2 } };
    const r = expectOk(applyCommand(late, { type: "SKIP_REMAINDER" }));
    expect(r.value.state.calendar).toMatchObject({ month: 2, period: "early", ap: 5 });
  });
});

describe("SPEND_AP", () => {
  it("decrements AP without rollover when AP remains", () => {
    const r = expectOk(applyCommand(freshState(), { type: "SPEND_AP", amount: 2 }));
    expect(r.value.state.calendar.ap).toBe(3);
    expect(r.value.rolledOver).toBe(false);
    expect(r.value.state.calendar.period).toBe("early");
  });

  it("rolls the action-day and refills AP when AP hits exactly 0", () => {
    const r = expectOk(applyCommand(freshState(), { type: "SPEND_AP", amount: 5 }));
    expect(r.value.rolledOver).toBe(true);
    expect(r.value.state.calendar).toMatchObject({ period: "mid", ap: 5, month: 1, year: 1 });
  });

  it("chains rollovers across 旬→月→年 via successive spends", () => {
    // 36 action-days in a year; spend a full 5-AP day each from 元年一月上旬.
    let state = freshState();
    for (let day = 0; day < 36; day++) {
      state = expectOk(applyCommand(state, { type: "SPEND_AP", amount: 5 })).value.state;
    }
    expect(state.calendar).toMatchObject({ year: 2, month: 1, period: "early", ap: 5 });
  });

  it("rejects overspend (AP_INSUFFICIENT) and leaves state untouched", () => {
    const before = freshState();
    const spent = expectOk(applyCommand(before, { type: "SPEND_AP", amount: 3 })).value.state;
    const r = expectErr(applyCommand(spent, { type: "SPEND_AP", amount: 3 }));
    expect(r.error.code).toBe("AP_INSUFFICIENT");
    expect(spent.calendar.ap).toBe(2); // untouched — AP can never go negative
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid amount %p", (amount) => {
    const r = expectErr(applyCommand(freshState(), { type: "SPEND_AP", amount }));
    expect(r.error.code).toBe("AP_INVALID_AMOUNT");
  });

  it("never mutates the input state", () => {
    const before = freshState();
    const snapshot = structuredClone(before);
    applyCommand(before, { type: "SPEND_AP", amount: 4 });
    expect(before).toEqual(snapshot);
  });
});

describe("MOVE_TO_LOCATION / SET_FLAG", () => {
  it("sets player location", () => {
    const r = expectOk(applyCommand(freshState(), { type: "MOVE_TO_LOCATION", locationId: "yuhuayuan" }));
    expect(r.value.state.playerLocation).toBe("yuhuayuan");
  });

  it("rejects empty location id", () => {
    expect(expectErr(applyCommand(freshState(), { type: "MOVE_TO_LOCATION", locationId: "" })).error.code).toBe(
      "BAD_LOCATION",
    );
  });

  it("sets flags of every value type without clobbering others", () => {
    let state = freshState();
    state = expectOk(applyCommand(state, { type: "SET_FLAG", key: "rite_scheduled", value: true })).value.state;
    state = expectOk(applyCommand(state, { type: "SET_FLAG", key: "intro_tone", value: "friendly" })).value.state;
    expect(state.flags).toEqual({ rite_scheduled: true, intro_tone: "friendly" });
  });

  it("rejects empty flag key", () => {
    expect(expectErr(applyCommand(freshState(), { type: "SET_FLAG", key: "", value: 1 })).error.code).toBe(
      "BAD_FLAG_KEY",
    );
  });
});

describe("applyBatch atomicity", () => {
  it("applies all commands and aggregates rolledOver", () => {
    const r = expectOk(
      applyBatch(freshState(), [
        { type: "SET_FLAG", key: "a", value: 1 },
        { type: "SPEND_AP", amount: 5 }, // triggers rollover
        { type: "MOVE_TO_LOCATION", locationId: "lantai" },
      ]),
    );
    expect(r.value.rolledOver).toBe(true);
    expect(r.value.state.flags["a"]).toBe(1);
    expect(r.value.state.playerLocation).toBe("lantai");
    expect(r.value.state.calendar.period).toBe("mid");
  });

  it("rejects the WHOLE batch when any command fails — earlier commands do not land", () => {
    const before = freshState();
    const r = expectErr(
      applyBatch(before, [
        { type: "SET_FLAG", key: "should_not_land", value: true },
        { type: "SPEND_AP", amount: 99 }, // fails: insufficient
        { type: "SET_FLAG", key: "never_reached", value: true },
      ]),
    );
    expect(r.error.code).toBe("BATCH_REJECTED");
    expect(r.error.message).toContain("SPEND_AP");
    // Caller keeps `before`, which is provably untouched:
    expect(before.flags).toEqual({});
    expect(before.calendar.ap).toBe(5);
  });

  it("empty batch is a no-op success", () => {
    const before = freshState();
    const r = expectOk(applyBatch(before, []));
    expect(r.value.state).toBe(before);
    expect(r.value.rolledOver).toBe(false);
  });
});
