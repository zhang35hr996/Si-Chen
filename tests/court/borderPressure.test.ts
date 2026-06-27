/**
 * Group A: borderPressure in NationState — initial value, Zod schema, effects.
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { applyEffects } from "../../src/engine/effects/funnel";
import { gameStateSchema } from "../../src/engine/save/stateSchema";

const db = loadRealContent();

describe("Group A: borderPressure initial value", () => {
  it("createNewGameState → borderPressure === 35", () => {
    const state = createNewGameState(db);
    expect(state.resources.nation.borderPressure).toBe(35);
  });
});

describe("Group A: borderPressure Zod schema", () => {
  function parseWithBorderPressure(value: unknown) {
    const s = createNewGameState(db);
    const raw = JSON.parse(JSON.stringify(s));
    raw.resources.nation.borderPressure = value;
    return gameStateSchema.safeParse(raw);
  }

  it("accepts 0", () => {
    expect(parseWithBorderPressure(0).success).toBe(true);
  });

  it("accepts 100", () => {
    expect(parseWithBorderPressure(100).success).toBe(true);
  });

  it("rejects -1", () => {
    expect(parseWithBorderPressure(-1).success).toBe(false);
  });

  it("rejects 101", () => {
    expect(parseWithBorderPressure(101).success).toBe(false);
  });

  it("rejects 0.5 (non-integer)", () => {
    expect(parseWithBorderPressure(0.5).success).toBe(false);
  });
});

describe("Group A: borderPressure effects", () => {
  it("effect with pillar=nation field=borderPressure updates the value", () => {
    const state = createNewGameState(db);
    const before = state.resources.nation.borderPressure; // 35
    const result = applyEffects(
      db,
      state,
      [{ type: "resource", pillar: "nation", field: "borderPressure", delta: 5 }],
      { sceneId: "test" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resources.nation.borderPressure).toBe(before + 5); // 40
  });

  it("AXIS_CAP: two effects each delta=7 → cumulative capped to 10 (not 14)", () => {
    // Resource effects are constrained to delta in [-10, +10] per effect by the schema.
    // AXIS_CAP caps the CUMULATIVE change per axis per batch at ±10.
    // Two effects of +7 each: cumulative would be 14, but capped to 10 → applied = 5 for second.
    const state = createNewGameState(db); // borderPressure=35
    const result = applyEffects(
      db,
      state,
      [
        { type: "resource", pillar: "nation", field: "borderPressure", delta: 7 },
        { type: "resource", pillar: "nation", field: "borderPressure", delta: 7 },
      ],
      { sceneId: "test" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without AXIS_CAP: 35+7+7=49. With AXIS_CAP=10: cumulative=7+7→capped10, second effect applied=3.
    // Result: 35+7+3=45 (not 49)
    expect(result.value.resources.nation.borderPressure).toBe(45);
  });

  it("clamp: borderPressure cannot go below 0 via effects", () => {
    const base = createNewGameState(db);
    const state = {
      ...base,
      resources: {
        ...base.resources,
        nation: { ...base.resources.nation, borderPressure: 5 },
      },
    };
    // delta=-10 is valid (max allowed negative). 5 + (-10) = -5, clamped to 0
    const result = applyEffects(
      db,
      state,
      [{ type: "resource", pillar: "nation", field: "borderPressure", delta: -10 }],
      { sceneId: "test" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 5 + (-10) = -5, clamped to 0
    expect(result.value.resources.nation.borderPressure).toBe(0);
  });

  it("clamp: borderPressure cannot go above 100 via effects", () => {
    const base = createNewGameState(db);
    const state = {
      ...base,
      resources: {
        ...base.resources,
        nation: { ...base.resources.nation, borderPressure: 95 },
      },
    };
    // delta=+10 is valid (max allowed positive). 95 + 10 = 105, clamped to 100
    const result = applyEffects(
      db,
      state,
      [{ type: "resource", pillar: "nation", field: "borderPressure", delta: 10 }],
      { sceneId: "test" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 95 + 10 = 105, clamped to 100
    expect(result.value.resources.nation.borderPressure).toBe(100);
  });
});
