import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** helper: bring the sovereign to status carrying (self-pregnancy). */
function carrying() {
  const s0 = withConsort(withConsort(createNewGameState(db), db, "lu_huaijin"), db, "xu_qinghuan");
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
    const state = withConsort(createNewGameState(db), db, "lu_huaijin"); // status none, no gestation
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }])).toHaveLength(1);
  });

  it("rejects a deceased / non-consort carrier", () => {
    const state = carrying();
    state.standing.lu_huaijin!.lifecycle = "deceased";
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "wei_sui", atMonth: 3 }])).toHaveLength(1);
  });

  it("rejects a carrier who is already carrying a gestation", () => {
    // First transfer to lu_huaijin succeeds (sovereign carrying → consort carrying).
    const first = applyEffects(db, carrying(), [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Sovereign conceives again and reaches carrying.
    const begun = applyEffects(db, first.value, [{ type: "pregnancy", op: "begin" }]);
    if (!begun.ok) throw new Error("begin failed");
    const carryingAgain = applyEffects(db, begun.value, [{ type: "pregnancy", op: "carry" }]);
    if (!carryingAgain.ok) throw new Error("carry failed");
    // A second transfer to the already-pregnant lu_huaijin must be rejected.
    expect(
      validateEffects(db, carryingAgain.value, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }]),
    ).toHaveLength(1);
  });
});
