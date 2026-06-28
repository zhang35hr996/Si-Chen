import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const HEIR_ID = "heir_000001";

function heirState(overrides: Partial<{ favor: number; neglect: number; imperialFear: number; closeness: number }> = {}): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: HEIR_ID, sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: overrides.favor ?? 50, legitimate: true, petName: "团团",
    education: { scholarship: 20, martial: 15, virtue: 18 },
    health: 70, talent: 55, diligence: 50, ambition: 20, closeness: overrides.closeness ?? 50, support: 20,
    faction: "none", lifecycle: "alive",
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 60, assertiveness: 40, curiosity: 65 },
    interests: [], imperialFear: overrides.imperialFear ?? 20, neglect: overrides.neglect ?? 40, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
  });
  return s;
}

// ── heir_audience ─────────────────────────────────────────────────────────────

describe("funnel: heir_audience — talk", () => {
  it("applies favor+2, closeness+3, imperialFear-2, neglect-8", () => {
    const r = applyEffects(db, heirState({ favor: 50, closeness: 50, imperialFear: 20, neglect: 40 }), [
      { type: "heir_audience", heirId: HEIR_ID, action: "talk" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(52);
    expect(h.closeness).toBe(53);
    expect(h.imperialFear).toBe(18);
    expect(h.neglect).toBe(32);
  });

  it("writes lastImperialInteractionAt", () => {
    const state = heirState();
    const r = applyEffects(db, state, [{ type: "heir_audience", heirId: HEIR_ID, action: "talk" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    const { year, month, period, dayIndex } = state.calendar;
    expect(h.lastImperialInteractionAt).toEqual({ year, month, period, dayIndex });
  });

  it("clamps neglect floor at 0", () => {
    const r = applyEffects(db, heirState({ neglect: 5 }), [
      { type: "heir_audience", heirId: HEIR_ID, action: "talk" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.neglect).toBe(0);
  });
});

describe("funnel: heir_audience — play", () => {
  it("applies favor+4, closeness+4, imperialFear-3, neglect-10", () => {
    const r = applyEffects(db, heirState({ favor: 50, closeness: 50, imperialFear: 20, neglect: 40 }), [
      { type: "heir_audience", heirId: HEIR_ID, action: "play" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(54);
    expect(h.closeness).toBe(54);
    expect(h.imperialFear).toBe(17);
    expect(h.neglect).toBe(30);
  });

  it("clamps all values to 0–100", () => {
    const r = applyEffects(db, heirState({ favor: 99, closeness: 99, imperialFear: 1, neglect: 5 }), [
      { type: "heir_audience", heirId: HEIR_ID, action: "play" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(100);
    expect(h.closeness).toBe(100);
    expect(h.imperialFear).toBe(0);
    expect(h.neglect).toBe(0);
  });

  it("rejects unknown heir", () => {
    const errs = validateEffects(db, heirState(), [{ type: "heir_audience", heirId: "bad_id", action: "play" }]);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.code).toBe("BAD_EFFECT_TARGET");
  });

  it("does NOT add the legacy +20 favor from heir_summon", () => {
    const r = applyEffects(db, heirState({ favor: 50 }), [
      { type: "heir_audience", heirId: HEIR_ID, action: "play" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).not.toBe(70);
  });
});

// ── heir_lesson_response ──────────────────────────────────────────────────────

describe("funnel: heir_lesson_response — praise", () => {
  it("applies favor+3, closeness+2, imperialFear-3", () => {
    const r = applyEffects(db, heirState({ favor: 50, closeness: 50, imperialFear: 20 }), [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "scholarship", performance: "good", response: "praise" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(53);
    expect(h.closeness).toBe(52);
    expect(h.imperialFear).toBe(17);
  });

  it("praise + excellent also adds diligence +1", () => {
    const state = heirState();
    const baseline = state.resources.bloodline.heirs[0]!.diligence;
    const r = applyEffects(db, state, [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "martial", performance: "excellent", response: "praise" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.diligence).toBe(baseline + 1);
  });

  it("praise + non-excellent does NOT add diligence", () => {
    const state = heirState();
    const baseline = state.resources.bloodline.heirs[0]!.diligence;
    const r = applyEffects(db, state, [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "virtue", performance: "good", response: "praise" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.diligence).toBe(baseline);
  });
});

describe("funnel: heir_lesson_response — admonish", () => {
  it("applies imperialFear+5, closeness-3", () => {
    const r = applyEffects(db, heirState({ closeness: 50, imperialFear: 20 }), [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "virtue", performance: "poor", response: "admonish" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.imperialFear).toBe(25);
    expect(h.closeness).toBe(47);
  });
});

describe("funnel: heir_lesson_response — neglect", () => {
  it("reduces neglect by 6 for all response types", () => {
    const base = 30;
    for (const response of ["praise", "admonish", "neutral"] as const) {
      const r = applyEffects(db, heirState({ neglect: base }), [
        { type: "heir_lesson_response", heirId: HEIR_ID, subject: "scholarship", performance: "good", response },
      ]);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value.resources.bloodline.heirs[0]!.neglect).toBe(base - 6);
    }
  });

  it("clamps neglect floor at 0", () => {
    const r = applyEffects(db, heirState({ neglect: 3 }), [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "virtue", performance: "mixed", response: "neutral" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.neglect).toBe(0);
  });
});

describe("funnel: heir_lesson_response — neutral", () => {
  it("applies favor+1, closeness+1", () => {
    const r = applyEffects(db, heirState({ favor: 50, closeness: 50 }), [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "scholarship", performance: "mixed", response: "neutral" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(51);
    expect(h.closeness).toBe(51);
  });

  it("writes lastImperialInteractionAt", () => {
    const state = heirState();
    const r = applyEffects(db, state, [
      { type: "heir_lesson_response", heirId: HEIR_ID, subject: "martial", performance: "good", response: "neutral" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { year, month, period, dayIndex } = state.calendar;
    expect(r.value.resources.bloodline.heirs[0]!.lastImperialInteractionAt).toEqual({ year, month, period, dayIndex });
  });

  it("rejects unknown heir", () => {
    const errs = validateEffects(db, heirState(), [
      { type: "heir_lesson_response", heirId: "ghost", subject: "virtue", performance: "good", response: "praise" },
    ]);
    expect(errs).toHaveLength(1);
  });
});
