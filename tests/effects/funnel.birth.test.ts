import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";
import type { GameState } from "../../src/engine/state/types";
import { buildBirthParentage } from "../../src/engine/characters/parentage/establishBirthParentage";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function consortCarrying(): GameState {
  const s0 = withConsort(withConsort(createNewGameState(db), db, "lu_huaijin"), db, "xu_qinghuan");
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error();
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error();
  const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }]);
  if (!c.ok) throw new Error();
  return c.value;
}

const baseBirth = {
  type: "birth" as const,
  sex: "daughter" as const,
  fatherId: "lu_huaijin",
  bearer: "lu_huaijin",
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
    expect(heirs[0]!.petName).toBe("");
    expect(heirs[0]!.givenName).toBeUndefined();
    expect(heirs[0]!.education).toEqual({ scholarship: 5, martial: 5, virtue: 5 });
    expect(heirs[0]!.custodianId).toBeUndefined();
    expect(heirs[0]!.fatherId).toBe("lu_huaijin");
    expect(r.value.standing.lu_huaijin!.lifecycle).toBe("delivered");
    expect(r.value.standing.lu_huaijin!.recoverUntilMonth).toBe(20);
    expect(r.value.resources.bloodline.gestations).toEqual([]);
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
    expect(r.value.parentage["heir_000001"]).toEqual(buildBirthParentage("lu_huaijin"));
  });

  it("child_dies → no heir, carrier normal + recoverUntilMonth", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "child_dies" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
    expect(r.value.standing.lu_huaijin!.lifecycle).toBe("normal");
    expect(r.value.standing.lu_huaijin!.recoverUntilMonth).toBe(20);
    expect(r.value.parentage).toEqual({});
  });

  it("bearer_dies → heir survives, gestation cleared; maternal death NOT set by birth effect alone", () => {
    // Under the unified death pipeline, the birth effect only handles survivor lifecycle.
    // bearer_dies/both: maternal death (deceased + deathRecord) comes from a subsequent
    // consort_decease effect emitted by planHealthChange(forceDeath:true). The birth effect
    // itself leaves the carrier lifecycle as-is (still "carrying" until consort_decease fires).
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "bearer_dies" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(1);
    expect(r.value.resources.bloodline.heirs[0]!.bearer).toBe("lu_huaijin");
    // Gestation cleared by birth effect; maternal death comes from subsequent consort_decease.
    expect(r.value.resources.bloodline.gestations).toEqual([]);
    expect(r.value.standing.lu_huaijin!.lifecycle).not.toBe("deceased"); // not dead yet without consort_decease
    expect(r.value.standing.lu_huaijin!.deathRecord).toBeUndefined();
  });

  it("both → no heir, gestation cleared; maternal death NOT set by birth effect alone", () => {
    // Same as bearer_dies: birth effect clears the gestation and records the heir (none here),
    // but leaves lifecycle/deathRecord to the subsequent consort_decease effect.
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "both" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
    expect(r.value.resources.bloodline.gestations).toEqual([]);
    expect(r.value.standing.lu_huaijin!.lifecycle).not.toBe("deceased"); // not dead yet without consort_decease
    expect(r.value.standing.lu_huaijin!.deathRecord).toBeUndefined();
    expect(r.value.parentage).toEqual({});
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
    expect(r.value.resources.bloodline.gestations).toEqual([]);
    expect(r.value.parentage[r.value.resources.bloodline.heirs[0]!.id])
      .toEqual(buildBirthParentage(null));
  });

  it("rejects a birth when no gestation is active (double-fire guard)", () => {
    const s0 = createNewGameState(db); // no gestation
    const errs = validateEffects(db, s0, [{ ...baseBirth, bearerOutcome: "safe" }]);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => e.message.includes("active gestation"))).toBe(true);
  });

  it("twin birth (twinSex+twinFavor) → two heirs with correct sex and favor", () => {
    const r = applyEffects(db, consortCarrying(), [{
      ...baseBirth,
      bearerOutcome: "safe",
      twinSex: "daughter",
      twinFavor: 35,
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const heirs = r.value.resources.bloodline.heirs;
    expect(heirs).toHaveLength(2);
    expect(heirs[0]!.sex).toBe("daughter");
    expect(heirs[0]!.favor).toBe(25);
    expect(heirs[0]!.id).toBe("heir_000001");
    expect(heirs[1]!.sex).toBe("daughter");
    expect(heirs[1]!.favor).toBe(35);
    expect(heirs[1]!.id).toBe("heir_000002");
    expect(heirs[1]!.bearer).toBe("lu_huaijin");
    expect(heirs[1]!.fatherId).toBe("lu_huaijin");
    expect(r.value.parentage["heir_000001"]).toEqual(buildBirthParentage("lu_huaijin"));
    expect(r.value.parentage["heir_000002"]).toEqual(buildBirthParentage("lu_huaijin"));
    expect(Object.keys(r.value.parentage)).toHaveLength(2);
  });

  it("twin birth with child_dies → no heirs (both die)", () => {
    const r = applyEffects(db, consortCarrying(), [{
      ...baseBirth,
      bearerOutcome: "child_dies",
      twinSex: "son",
      twinFavor: 20,
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
  });

  it("twin birth with bearer_dies → two heirs survive", () => {
    const r = applyEffects(db, consortCarrying(), [{
      ...baseBirth,
      bearerOutcome: "bearer_dies",
      twinSex: "son",
      twinFavor: 30,
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(2);
  });

  it("rejects twinSex without twinFavor (unpaired)", () => {
    const errs = validateEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe", twinSex: "son" }]);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => e.message.includes("twinSex") && e.message.includes("twinFavor"))).toBe(true);
  });

  it("rejects twinFavor without twinSex (unpaired)", () => {
    const errs = validateEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe", twinFavor: 20 }]);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => e.message.includes("twinSex") && e.message.includes("twinFavor"))).toBe(true);
  });

  it("生成侍君（generated_consort_*）在原始 ContentDB 下可作 bearer/father 通过 birth 校验并生产", () => {
    // 关键：全程用原始 content.value（未合并 generatedConsorts），模拟生产结算路径。
    const s0 = createNewGameState(db, 1);
    const carrierId = Object.keys(s0.generatedConsorts).find(
      (id) => !id.startsWith("generated_empress_") && s0.standing[id]?.lifecycle !== "deceased",
    )!;
    expect(carrierId).toBeDefined();
    expect(db.characters[carrierId]).toBeUndefined(); // 确认不在内容库

    // 帝王自孕 → carry → 承养给生成侍君
    const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
    if (!a.ok) throw new Error("begin");
    const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
    if (!b.ok) throw new Error("carry");
    const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId, atMonth: 3 }]);
    if (!c.ok) throw new Error("transfer");
    const carrying = c.value;

    // birth：bearer 与 fatherId 都是生成侍君；校验应接受（旧实现只查 db.characters 会拒绝）
    const birth = {
      type: "birth" as const,
      sex: "son" as const,
      fatherId: carrierId,
      bearer: carrierId,
      legitimate: false,
      favor: 30,
      recoverUntilMonth: 18,
      bearerOutcome: "safe" as const,
    };
    expect(validateEffects(db, carrying, [birth])).toEqual([]);

    const r = applyEffects(db, carrying, [birth]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const heirs = r.value.resources.bloodline.heirs;
    expect(heirs).toHaveLength(1);
    expect(heirs[0]!.bearer).toBe(carrierId);
    expect(heirs[0]!.fatherId).toBe(carrierId);
    expect(r.value.standing[carrierId]!.lifecycle).toBe("delivered");
    expect(r.value.resources.bloodline.gestations).toEqual([]);
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
    const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId: "xu_qinghuan", atMonth: 3 }]);
    if (!c.ok) return;
    const second = applyEffects(db, c.value, [{ ...baseBirth, fatherId: "xu_qinghuan", bearer: "xu_qinghuan", bearerOutcome: "safe" }]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const ids = second.value.resources.bloodline.heirs.map((h) => h.id);
    expect(ids).toEqual(["heir_000001", "heir_000002"]);
  });
});
