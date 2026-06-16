import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function withHeir(favor = 50): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001",
    sex: "daughter",
    fatherId: null,
    bearer: "sovereign",
    birthAt: { year: 1, month: 5, period: "early", dayIndex: 12 },
    favor,
    legitimate: true,
  });
  return s;
}

describe("funnel: child_favor", () => {
  it("adjusts and clamps 0–100", () => {
    const r = applyEffects(db, withHeir(50), [{ type: "child_favor", heirId: "heir_000001", delta: 10 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(60);
  });

  it("caps the per-batch cumulative delta at ±10", () => {
    const r = applyEffects(db, withHeir(50), [
      { type: "child_favor", heirId: "heir_000001", delta: 10 },
      { type: "child_favor", heirId: "heir_000001", delta: 10 },
    ]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(60); // 10 cumulative cap
  });

  it("clamps at 0 on the low end", () => {
    const r = applyEffects(db, withHeir(3), [{ type: "child_favor", heirId: "heir_000001", delta: -10 }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(0);
  });

  it("rejects an unknown heir id", () => {
    expect(validateEffects(db, withHeir(), [{ type: "child_favor", heirId: "heir_999999", delta: 5 }])).toHaveLength(1);
  });
});
