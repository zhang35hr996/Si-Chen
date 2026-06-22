import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

describe("sovereign death", () => {
  it("flags sovereignDied, never enqueues sovereign aftermath", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.health = 1;
    s.resources.sovereign.healthStatus = "critical";
    const r = buildMonthlyHealthTick(db, s);
    expect(r.sovereignDied).toBe(true);
    expect(r.aftermathDeaths.length).toBe(0);
  });
});
