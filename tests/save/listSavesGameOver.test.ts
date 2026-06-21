/**
 * Task 6: listSaves surfaces a gameOver flag so the title menu can disable 继续
 * on a 终局 autosave (先帝已崩).
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { autosave, listSaves } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("listSaves gameOver flag", () => {
  it("flags a 终局 autosave and leaves a normal autosave unflagged", () => {
    const storage = createMemoryStorage();

    // Normal autosave: no gameOver.
    autosave(storage, db, createNewGameState(db));
    const normal = listSaves(storage).find((s) => s.slot === "auto");
    expect(normal?.status).toBe("ok");
    expect(normal?.gameOver).toBeUndefined();

    // Overwrite with a 终局 state.
    const dead = createNewGameState(db);
    dead.gameOver = { cause: "sovereign_death", at: toGameTime(dead.calendar) };
    autosave(storage, db, dead);
    const over = listSaves(storage).find((s) => s.slot === "auto");
    expect(over?.status).toBe("ok");
    expect(over?.gameOver).toBe(true);
  });
});
