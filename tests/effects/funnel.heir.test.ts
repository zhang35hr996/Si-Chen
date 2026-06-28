import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const mkState = () => withConsort(withConsort(createNewGameState(db), db, "shen_zhibai"), db, "lu_huaijin");

describe("funnel: heir_designate", () => {
  it("tags consorts candidate + records candidateIds", () => {
    const state = mkState();
    const r = applyEffects(db, state, [{ type: "heir_designate", charIds: ["lu_huaijin", "shen_zhibai"] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing.lu_huaijin!.lifecycle).toBe("candidate");
    expect(r.value.standing.shen_zhibai!.lifecycle).toBe("candidate");
    expect(r.value.resources.bloodline.pregnancy.candidateIds).toEqual(["lu_huaijin", "shen_zhibai"]);
  });

  it("rejects an official or unknown target", () => {
    const state = createNewGameState(db);
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["wei_sui"] }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["nobody"] }])).toHaveLength(1);
  });

  it("rejects a deceased consort", () => {
    const state = mkState();
    state.standing.lu_huaijin!.lifecycle = "deceased";
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["lu_huaijin"] }])).toHaveLength(1);
  });
});
