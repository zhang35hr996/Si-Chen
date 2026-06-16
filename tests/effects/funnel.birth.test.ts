import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function consortCarrying(): GameState {
  const s0 = createNewGameState(db);
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error();
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error();
  const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
  if (!c.ok) throw new Error();
  return c.value;
}

const baseBirth = {
  type: "birth" as const,
  sex: "daughter" as const,
  fatherId: "shen_chenghui",
  bearer: "shen_chenghui",
  legitimate: false,
  favor: 25,
  recoverUntilMonth: 20,
};

describe("funnel: birth", () => {
  it("safe → appends heir, carrier delivered + recoverUntilMonth, gestation cleared", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const heirs = r.value.resources.bloodline.heirs;
    expect(heirs).toHaveLength(1);
    expect(heirs[0]!.id).toBe("heir_000001");
    expect(heirs[0]!.favor).toBe(25);
    expect(heirs[0]!.sex).toBe("daughter");
    expect(heirs[0]!.fatherId).toBe("shen_chenghui");
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("delivered");
    expect(r.value.standing.shen_chenghui!.recoverUntilMonth).toBe(20);
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
  });

  it("child_dies → no heir, carrier normal + recoverUntilMonth", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "child_dies" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("normal");
    expect(r.value.standing.shen_chenghui!.recoverUntilMonth).toBe(20);
  });

  it("bearer_dies → heir survives, carrier deceased (no recovery)", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "bearer_dies" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(1);
    expect(r.value.resources.bloodline.heirs[0]!.bearer).toBe("shen_chenghui");
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("deceased");
    expect(r.value.standing.shen_chenghui!.recoverUntilMonth).toBeUndefined();
  });

  it("both → no heir, carrier deceased", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "both" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("deceased");
    expect(r.value.standing.shen_chenghui!.recoverUntilMonth).toBeUndefined();
  });

  it("self-pregnancy birth (bearer sovereign) appends heir, no standing change", () => {
    const s0 = createNewGameState(db);
    const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
    if (!b.ok) return;
    const r = applyEffects(db, b.value, [
      { type: "birth", sex: "son", fatherId: null, bearer: "sovereign", legitimate: true, favor: 100, bearerOutcome: "safe" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(1);
    expect(r.value.resources.bloodline.heirs[0]!.bearer).toBe("sovereign");
    expect(r.value.resources.bloodline.heirs[0]!.fatherId).toBeNull();
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
  });

  it("assigns monotonic heir ids across sequential safe births", () => {
    const first = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe" }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // a second pregnancy + transfer + birth on the resulting state
    const a = applyEffects(db, first.value, [{ type: "pregnancy", op: "begin" }]);
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
    if (!b.ok) return;
    const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId: "chu_jun", atMonth: 3 }]);
    if (!c.ok) return;
    const second = applyEffects(db, c.value, [{ ...baseBirth, fatherId: "chu_jun", bearer: "chu_jun", bearerOutcome: "safe" }]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const ids = second.value.resources.bloodline.heirs.map((h) => h.id);
    expect(ids).toEqual(["heir_000001", "heir_000002"]);
  });
});
