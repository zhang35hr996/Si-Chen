import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("gameStateSchema persists bedchamber + pregnancy", () => {
  it("round-trips a state with encounters and an expecting pregnancy", () => {
    let state = createNewGameState(db);
    const a = applyEffects(db, state, [{ type: "bedchamber", char: "shen_chenghui", mode: "passion" }]);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "begin" }]);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const c = applyEffects(db, b.value, [{ type: "pregnancy", op: "confirm", fatherIds: ["shen_chenghui"] }]);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    state = c.value;
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
  });

  it("rejects a state missing pregnancy", () => {
    const state = createNewGameState(db) as Record<string, any>;
    delete (state.resources.bloodline as Record<string, unknown>).pregnancy;
    expect(gameStateSchema.safeParse(state).success).toBe(false);
  });
});
