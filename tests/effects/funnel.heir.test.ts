import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("funnel: heir_designate", () => {
  it("tags consorts candidate + records candidateIds", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "heir_designate", charIds: ["shen_chenghui", "feng_hou"] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("candidate");
    expect(r.value.standing.feng_hou!.lifecycle).toBe("candidate");
    expect(r.value.resources.bloodline.pregnancy.candidateIds).toEqual(["shen_chenghui", "feng_hou"]);
  });

  it("rejects an official or unknown target", () => {
    const state = createNewGameState(db);
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["sili_nvguan"] }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["nobody"] }])).toHaveLength(1);
  });

  it("rejects a deceased consort", () => {
    const state = createNewGameState(db);
    state.standing.shen_chenghui!.lifecycle = "deceased";
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["shen_chenghui"] }])).toHaveLength(1);
  });
});
