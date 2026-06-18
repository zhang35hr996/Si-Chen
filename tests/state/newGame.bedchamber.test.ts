import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";

describe("newGame bedchamber + pregnancy init", () => {
  const content = loadGameContent();
  if (!content.ok) throw new Error("content failed to load in test fixture");
  const db = content.value;

  it("gives every consort an empty bedchamber record and officials none", () => {
    const state = createNewGameState(db);
    for (const c of Object.values(db.characters)) {
      if (c.kind === "consort") {
        expect(state.bedchamber[c.id]).toEqual({ encounters: [] });
      } else {
        expect(state.bedchamber[c.id]).toBeUndefined();
      }
    }
  });

  it("starts pregnancy at none", () => {
    const state = createNewGameState(db);
    expect(state.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
  });
});
