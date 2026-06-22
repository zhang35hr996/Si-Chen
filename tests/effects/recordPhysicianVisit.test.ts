import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import type { Heir } from "../../src/engine/state/types";

const dbResult = loadGameContent();
if (!dbResult.ok) throw new Error("content load failed");
const db = dbResult.value;

const monthKey = (s: { calendar: { year: number; month: number } }) => `${s.calendar.year}:${s.calendar.month}`;

function makeHeir(id: string, lifecycle: "alive" | "deceased"): Heir {
  return {
    id, sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 50, legitimate: true, petName: "儿",
    education: { scholarship: 0, martial: 0, virtue: 0 },
    health: 80, talent: 50, diligence: 50, ambition: 50, closeness: 50, support: 50,
    faction: "none", lifecycle,
    ...(lifecycle === "deceased" ? { deceasedAt: { year: 1, month: 2, period: "early", dayIndex: 30 } } : {}),
  };
}

describe("record_physician_visit", () => {
  it("写皇帝/太后的本月已请脉月键", () => {
    const s0 = createNewGameState(db);
    const mk = monthKey(s0);
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk },
      { type: "record_physician_visit", subject: { kind: "taihou" }, monthKey: mk },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.sovereign.lastPhysicianVisitMonthKey).toBe(mk);
    expect(r.value.taihou.lastPhysicianVisitMonthKey).toBe(mk);
  });

  it("写侍君的本月已请脉月键", () => {
    const s0 = createNewGameState(db);
    const cid = Object.keys(s0.standing).find((id) => s0.standing[id]!.lifecycle !== "deceased" && db.characters[id]?.kind === "consort")!;
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subject: { kind: "consort", id: cid }, monthKey: monthKey(s0) },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.lastPhysicianVisitMonthKey).toBe(monthKey(s0));
  });

  it("拒绝：月键非当月", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: "999:9" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("拒绝：本月已对该目标请脉（连续第二次 applyEffects）", () => {
    const s0 = createNewGameState(db);
    const mk = monthKey(s0);
    const first = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyEffects(db, first.value, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk }]);
    expect(second.ok).toBe(false);
  });

  it("拒绝：不存在的侍君 / 已薨太后", () => {
    const s0 = createNewGameState(db);
    const mk = monthKey(s0);
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "consort", id: "nope_xyz" }, monthKey: mk }]).ok).toBe(false);
    const dead = structuredClone(s0);
    dead.taihou.deceased = true;
    expect(applyEffects(db, dead, [{ type: "record_physician_visit", subject: { kind: "taihou" }, monthKey: mk }]).ok).toBe(false);
  });

  it("记录成功：存活皇嗣写月键", () => {
    const s0 = createNewGameState(db);
    s0.resources.bloodline.heirs.push(makeHeir("heir_alive", "alive"));
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "heir", id: "heir_alive" }, monthKey: monthKey(s0) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.find((h) => h.id === "heir_alive")!.lastPhysicianVisitMonthKey).toBe(monthKey(s0));
  });

  it("拒绝：已故皇嗣", () => {
    const s0 = createNewGameState(db);
    s0.resources.bloodline.heirs.push(makeHeir("heir_dead", "deceased"));
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "heir", id: "heir_dead" }, monthKey: monthKey(s0) }]).ok).toBe(false);
  });

  it("拒绝：已故侍君", () => {
    const s0 = createNewGameState(db);
    const cid = Object.keys(s0.standing).find((id) => s0.standing[id]!.lifecycle !== "deceased" && db.characters[id]?.kind === "consort")!;
    s0.standing[cid]!.lifecycle = "deceased";
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "consort", id: cid }, monthKey: monthKey(s0) }]).ok).toBe(false);
  });

  it("拒绝：consort id 指向非侍君（有 standing 但无侍君角色记录）", () => {
    const s0 = createNewGameState(db);
    // standing 存在但 db.characters/generatedConsorts 中无该 id → c 为空 → 非侍君 → 拒绝
    s0.standing["ghost_official"] = { ...s0.standing[Object.keys(s0.standing)[0]!]!, lifecycle: "normal" };
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "consort", id: "ghost_official" }, monthKey: monthKey(s0) }]).ok).toBe(false);
  });
});
