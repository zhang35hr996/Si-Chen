import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function heirWithFavor(favor: number): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  });
  return s;
}

describe("funnel: heir_summon", () => {
  it("adds 20 favor without the ±10 cap", () => {
    const r = applyEffects(db, heirWithFavor(50), [{ type: "heir_summon", heirId: "heir_000001" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(70);
  });

  it("clamps at 100", () => {
    const r = applyEffects(db, heirWithFavor(90), [{ type: "heir_summon", heirId: "heir_000001" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(100);
  });

  it("rejects unknown heir", () => {
    expect(validateEffects(db, heirWithFavor(50), [{ type: "heir_summon", heirId: "x" }])).toHaveLength(1);
  });
});
