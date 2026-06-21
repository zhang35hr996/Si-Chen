import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";

describe("storehouse + affection schema", () => {
  it("初始 state 带空 storehouse 且通过 schema", () => {
    const s = createInitialState();
    expect(s.resources.storehouse).toEqual({ items: {} });
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("standing.affection 可选且 0–100", () => {
    const s = createInitialState();
    s.resources.storehouse.items["luozidai"] = 2;
    s.standing["x"] = { rank: "chenghui", favor: 50, affection: 80 };
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.standing["x"]!.affection = 200;
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });
});
