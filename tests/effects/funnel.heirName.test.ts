import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function withOneHeir(): GameState {
  const s0 = createNewGameState(db);
  s0.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 50, legitimate: true, petName: "", education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
    interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
  });
  return s0;
}

describe("funnel: heir_name", () => {
  it("sets petName", () => {
    const r = applyEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "heir_000001", field: "pet", name: "环环" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.petName).toBe("环环");
  });

  it("sets givenName", () => {
    const r = applyEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "heir_000001", field: "given", name: "长安" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.givenName).toBe("长安");
  });

  it("rejects unknown heir", () => {
    expect(validateEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "nope", field: "pet", name: "环环" }])).toHaveLength(1);
  });

  it("rejects names longer than 2 chars (schema)", () => {
    expect(validateEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "heir_000001", field: "pet", name: "三个字" }])).toHaveLength(1);
  });
});
