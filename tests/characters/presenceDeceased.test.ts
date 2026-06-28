import { describe, expect, it } from "vitest";
import { getPresentAt, presentAt, absentAt, getCharacterLocation } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

/** Pick a living consort who is not in 冷宫 and has a standing entry. */
function pickConsort(s: ReturnType<typeof createNewGameState>): string {
  for (const c of Object.values(db.characters)) {
    if (c.kind !== "consort") continue;
    if (c.defaultLocation === "changmengong") continue;
    if (s.standing[c.id]) return c.id;
  }
  // Fall back to generated consorts (story consorts may be event_only)
  for (const [id, gc] of Object.entries(s.generatedConsorts)) {
    if (gc.kind !== "consort") continue;
    const st = s.standing[id];
    if (st && st.lifecycle !== "deceased" && st.residence !== "changmengong") return id;
  }
  throw new Error("no consort fixture");
}

describe("deceased consorts are excluded from scene rosters", () => {
  it("does NOT appear in getPresentAt / presentAt of their residence, nor in absentAt", () => {
    const s = createNewGameState(db);
    const consortId = pickConsort(s);
    const residence = getCharacterLocation(db, s, consortId)!;
    expect(residence).toBeTruthy();

    // Sanity: alive consort IS at their residence (guard against vacuous pass).
    expect(getPresentAt(db, s, residence).some((c) => c.id === consortId)).toBe(true);

    // Kill the consort.
    s.standing[consortId]!.lifecycle = "deceased";

    expect(getPresentAt(db, s, residence).some((c) => c.id === consortId)).toBe(false);
    expect(presentAt(db, s, residence).some((c) => c.id === consortId)).toBe(false);

    // Also absent from the absentAt roster (it is built off the scene set).
    const absent = absentAt(db, s, residence);
    expect(Object.keys(absent)).not.toContain(consortId);
  });
});
