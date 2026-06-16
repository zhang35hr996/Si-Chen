import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function carrying() {
  const s0 = createNewGameState(db);
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error();
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error();
  return b.value;
}

describe("funnel: pregnancy_abort", () => {
  it("clears self-pregnancy", () => {
    const r = applyEffects(db, carrying(), [{ type: "pregnancy_abort" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
  });

  it("rejects when carrier is a consort (承养不可弃)", () => {
    const transferred = applyEffects(db, carrying(), [
      { type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 },
    ]);
    if (!transferred.ok) return;
    expect(validateEffects(db, transferred.value, [{ type: "pregnancy_abort" }])).toHaveLength(1);
  });

  it("rejects when not pregnant", () => {
    expect(validateEffects(db, createNewGameState(db), [{ type: "pregnancy_abort" }])).toHaveLength(1);
  });
});
