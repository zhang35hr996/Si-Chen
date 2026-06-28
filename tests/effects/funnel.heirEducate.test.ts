import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function heirState(): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
    interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" },
  });
  return s;
}

describe("funnel: heir_educate", () => {
  it("raises one subject and favor, clamped", () => {
    const r = applyEffects(db, heirState(), [
      { type: "heir_educate", heirId: "heir_000001", subject: "scholarship", attrDelta: 8, favorDelta: 5 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.education.scholarship).toBe(13);
    expect(h.education.martial).toBe(5);
    expect(h.favor).toBe(45);
  });

  it("rejects unknown heir and out-of-range delta", () => {
    expect(validateEffects(db, heirState(), [{ type: "heir_educate", heirId: "x", subject: "virtue", attrDelta: 5, favorDelta: 5 }])).toHaveLength(1);
    expect(validateEffects(db, heirState(), [{ type: "heir_educate", heirId: "heir_000001", subject: "virtue", attrDelta: 99, favorDelta: 5 }])).toHaveLength(1);
  });
});
