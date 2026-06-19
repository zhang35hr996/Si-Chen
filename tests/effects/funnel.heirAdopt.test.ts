import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function heirState(): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  });
  return s;
}

describe("funnel: heir_adopt", () => {
  it("sets adoptiveFatherId for an in-palace consort", () => {
    const r = applyEffects(db, heirState(), [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "lu_huaijin" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.adoptiveFatherId).toBe("lu_huaijin");
  });

  it("rejects a deceased consort", () => {
    const s = heirState();
    s.standing.lu_huaijin!.lifecycle = "deceased";
    expect(validateEffects(db, s, [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "lu_huaijin" }])).toHaveLength(1);
  });

  it("rejects a cold-palace consort (defaultLocation lenggong)", () => {
    expect(validateEffects(db, heirState(), [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "wenya" }])).toHaveLength(1);
  });

  it("rejects unknown heir / non-consort", () => {
    expect(validateEffects(db, heirState(), [{ type: "heir_adopt", heirId: "x", fatherId: "lu_huaijin" }])).toHaveLength(1);
    expect(validateEffects(db, heirState(), [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "wei_sui" }])).toHaveLength(1);
  });

  it("accepts elder 太后 as adoptive father, rejects official", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.heirs.push({
      id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: false, petName: "",
      education: { scholarship: 5, martial: 5, virtue: 5 },
    });
    const okR = applyEffects(db, s, [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "taihou" }]);
    expect(okR.ok).toBe(true);
    const badR = applyEffects(db, s, [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "wei_sui" }]);
    expect(badR.ok).toBe(false);
  });
});
