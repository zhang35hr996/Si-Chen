import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("generatedConsorts in GameState", () => {
  it("createNewGameState seeds an empty generatedConsorts map", () => {
    const s = createNewGameState(db);
    expect(s.generatedConsorts).toEqual({});
  });

  it("a state carrying a generated consort + availableFromMonth round-trips through the save schema", () => {
    const s = createNewGameState(db);
    const sample = db.characters["lu_huaijin"]!;
    const withGen = {
      ...s,
      generatedConsorts: { xiunan_1_0: { ...sample, id: "xiunan_1_0", defaultLocation: "chuxiu_gong" } },
      standing: { ...s.standing, xiunan_1_0: { rank: "gengyi", favor: 10, residence: "chuxiu_gong", chamber: "main" as const, availableFromMonth: 5 } },
    };
    const parsed = gameStateSchema.safeParse(withGen);
    expect(parsed.success).toBe(true);
  });
});
