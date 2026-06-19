import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** helper: bring the sovereign to status carrying (self-pregnancy). */
function carrying() {
  const s0 = createNewGameState(db);
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error("begin failed");
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error("carry failed");
  return b.value;
}

describe("funnel: pregnancy_transfer", () => {
  it("moves carrier to consort, sets status none + lifecycle carrying", () => {
    const state = carrying();
    const r = applyEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy.status).toBe("none");
    expect(r.value.resources.bloodline.gestations).toEqual([
      {
        carrier: "lu_huaijin",
        fatherId: "lu_huaijin",
        transferredAtMonth: 3,
        conceivedAt: state.resources.bloodline.gestations[0]!.conceivedAt,
      },
    ]);
    expect(r.value.standing.lu_huaijin!.lifecycle).toBe("carrying");
  });

  it("rejects when sovereign is not carrying", () => {
    const state = createNewGameState(db); // status none, no gestation
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }])).toHaveLength(1);
  });

  it("rejects a deceased / non-consort carrier", () => {
    const state = carrying();
    state.standing.lu_huaijin!.lifecycle = "deceased";
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "wei_sui", atMonth: 3 }])).toHaveLength(1);
  });
});
