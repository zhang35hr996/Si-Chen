import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { loadGameContent } from "../../src/engine/content/viteSource";

describe("stateSchema health fields", () => {
  it("new game state parses with health/status/pendingAftermath", () => {
    const loaded = loadGameContent();
    if (!loaded.ok) throw new Error("content load failed");
    const state = createNewGameState(loaded.value);
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(state.resources.sovereign.healthStatus).toBe("healthy");
    expect(state.taihou.health).toBe(70);
    expect(Array.isArray(state.pendingAftermath)).toBe(true);
  });
});
