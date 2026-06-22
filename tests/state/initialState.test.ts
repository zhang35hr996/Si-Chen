import { describe, expect, it } from "vitest";
import { formatAp, formatGameTime } from "../../src/engine/calendar/time";
import { createInitialState } from "../../src/engine/state/initialState";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("createInitialState", () => {
  it("starts at 元年一月上旬 with 行动点：6/6 (skeleton-plan §13 #2)", () => {
    const state = createInitialState();
    expect(formatGameTime(state.calendar)).toBe("元年一月上旬");
    expect(formatAp(state.calendar)).toBe("行动点：6/6");
  });

  it("initializes the resource pillars with placeholder values", () => {
    const { resources } = createInitialState();
    expect(resources.sovereign).toEqual({ health: 70, healthStatus: "healthy", diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 });
    expect(resources.nation).toEqual({ military: 50, treasury: 10000, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10 });
    expect(resources.bloodline).toEqual({
      menstrualStatus: "normal",
      pregnancy: { status: "none", candidateIds: [] },
      gestations: [],
      heirs: [],
    });
  });

  it("starts with empty collections and a deterministic rng seed", () => {
    const state = createInitialState();
    expect(state.flags).toEqual({});
    expect(state.standing).toEqual({});
    expect(state.officials).toEqual({});
    expect(state.memories).toEqual({});
    expect(state.eventLog).toEqual([]);
    expect(state.sceneHistory).toEqual([]);
    expect(state.playerLocation).toBe("");
    expect(state.rngSeed).toBe(1);
  });

  it("honors overrides", () => {
    const state = createInitialState({
      calendar: { year: 3, month: 6, period: "late", apMax: 4 },
      playerLocation: "zichendian",
      rngSeed: 42,
    });
    expect(formatGameTime(state.calendar)).toBe("三年六月下旬");
    expect(state.calendar.ap).toBe(4);
    expect(state.playerLocation).toBe("zichendian");
    expect(state.rngSeed).toBe(42);
  });

  it("eventReactionLog defaults to []", () => {
    const state = createInitialState();
    expect(state.eventReactionLog).toEqual([]);
  });
});

describe("createNewGameState", () => {
  it("eventReactionLog defaults to []", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    expect(state.eventReactionLog).toEqual([]);
  });
});
