import { describe, expect, it } from "vitest";
import { formatAp, formatGameTime } from "../../src/engine/calendar/time";
import { createInitialState } from "../../src/engine/state/initialState";

describe("createInitialState", () => {
  it("starts at 元年一月上旬 with 行动点：6/6 (skeleton-plan §13 #2)", () => {
    const state = createInitialState();
    expect(formatGameTime(state.calendar)).toBe("元年一月上旬");
    expect(formatAp(state.calendar)).toBe("行动点：6/6");
  });

  it("initializes the three resource pillars with placeholder values", () => {
    const { resources } = createInitialState();
    expect(resources.court).toEqual({ authority: 50, publicSupport: 50, factionPressure: 20 });
    expect(resources.harem).toEqual({ harmony: 60, jealousy: 20 });
    expect(resources.bloodline).toEqual({
      legitimacy: 60,
      menstrualStatus: "normal",
      pregnancy: { status: "none", fatherIds: [] },
      heirs: [],
    });
  });

  it("starts with empty collections and a deterministic rng seed", () => {
    const state = createInitialState();
    expect(state.flags).toEqual({});
    expect(state.relationships).toEqual({});
    expect(state.standing).toEqual({});
    expect(state.memories).toEqual({});
    expect(state.eventLog).toEqual([]);
    expect(state.sceneHistory).toEqual([]);
    expect(state.playerLocation).toBe("");
    expect(state.rngSeed).toBe(1);
  });

  it("honors overrides", () => {
    const state = createInitialState({
      calendar: { year: 3, month: 6, period: "late", apMax: 4 },
      playerLocation: "yushufang",
      rngSeed: 42,
    });
    expect(formatGameTime(state.calendar)).toBe("三年六月下旬");
    expect(state.calendar.ap).toBe(4);
    expect(state.playerLocation).toBe("yushufang");
    expect(state.rngSeed).toBe(42);
  });
});
