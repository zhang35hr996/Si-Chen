import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { autosave, readSlot } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("gameOver save round-trip", () => {
  it("gameStateSchema accepts state with gameOver set", () => {
    const state = createNewGameState(db);
    state.gameOver = { cause: "sovereign_death", at: toGameTime(state.calendar) };
    expect(gameStateSchema.safeParse(state).success).toBe(true);
  });

  it("gameStateSchema still accepts state without gameOver", () => {
    const state = createNewGameState(db);
    expect(state.gameOver).toBeUndefined();
    expect(gameStateSchema.safeParse(state).success).toBe(true);
  });

  it("autosave + readSlot round-trips a gameOver state", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    state.gameOver = { cause: "sovereign_death", at: toGameTime(state.calendar) };

    const written = autosave(storage, db, state);
    expect(written.ok).toBe(true);

    const loaded = readSlot(storage, db, "auto");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.state.gameOver).toEqual({
        cause: "sovereign_death",
        at: toGameTime(state.calendar),
      });
    }
  });
});
