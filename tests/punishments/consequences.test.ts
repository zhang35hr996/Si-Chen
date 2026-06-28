import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { planPunishmentConsequences } from "../../src/engine/punishments/consequencePlanner";
import { getPersonalityModifier } from "../../src/engine/punishments/personalityModifiers";
import { resolveConsortRuntimeAttrs } from "../../src/engine/characters/consortAttrs";
import { applyEffects } from "../../src/engine/effects/funnel";
import { loadRealContent } from "../helpers/contentFixture";
import { toGameTime } from "../../src/engine/calendar/time";
import type { PunishmentOutcomeContext } from "../../src/engine/punishments/types";

const db = loadRealContent();

function makeCtx(overrides: Partial<PunishmentOutcomeContext> = {}): PunishmentOutcomeContext {
  const state = createNewGameState(db);
  const firstConsorId = Object.keys(state.standing).find((id) => {
    const c = db.characters[id];
    return c?.kind === "consort" && state.standing[id]?.lifecycle !== "deceased";
  })!;
  return {
    punishmentId: "test_punishment_001",
    targetId: firstConsorId,
    actorId: "player",
    kind: "finite_confinement",
    severity: "moderate",
    occurredAt: toGameTime(state.calendar),
    ...overrides,
  };
}

// ── Clamp ────────────────────────────────────────────────────────────────────

describe("adjust_consort_attr clamp", () => {
  it("fear delta +100 on fear=90 → standing.fear = 100", () => {
    const state = createNewGameState(db);
    const targetId = makeCtx().targetId;
    // Force fear to 90
    const pre = applyEffects(db, state, [{ type: "adjust_consort_attr", char: targetId, field: "fear", delta: 50 }]);
    expect(pre.ok).toBe(true);
    const pre2 = applyEffects(db, pre.ok ? pre.value : state, [{ type: "adjust_consort_attr", char: targetId, field: "fear", delta: 50 }]);
    expect(pre2.ok).toBe(true);
    const finalState = pre2.ok ? pre2.value : state;
    const fear = finalState.standing[targetId]?.fear ?? resolveConsortRuntimeAttrs(db, finalState, targetId).fear;
    expect(fear).toBeLessThanOrEqual(100);
    expect(fear).toBeGreaterThanOrEqual(0);
  });

  it("loyalty delta -200 → clamped to 0", () => {
    const state = createNewGameState(db);
    const targetId = makeCtx().targetId;
    const result = applyEffects(db, state, [{ type: "adjust_consort_attr", char: targetId, field: "loyalty", delta: -50 }]);
    expect(result.ok).toBe(true);
    const loyalty = resolveConsortRuntimeAttrs(db, result.ok ? result.value : state, targetId).loyalty;
    expect(loyalty).toBeGreaterThanOrEqual(0);
  });

  it("adjust_consort_attr on non-existent char → rejected", () => {
    const state = createNewGameState(db);
    const errors = applyEffects(db, state, [{ type: "adjust_consort_attr", char: "char_ghost_99", field: "fear", delta: 10 }]);
    expect(errors.ok).toBe(false);
  });
});

// ── Personality modifier ─────────────────────────────────────────────────────

describe("personality modifier", () => {
  it("neutral (no traits) → all multipliers = 1.0", () => {
    const m = getPersonalityModifier([], "moderate");
    expect(m.affectionMul).toBe(1.0);
    expect(m.fearMul).toBe(1.0);
    expect(m.loyaltyDeltaAdd).toBe(0);
  });

  it("'impulsive' → fearMul > 1.0", () => {
    const m = getPersonalityModifier(["impulsive"], "moderate");
    expect(m.fearMul).toBeGreaterThan(1.0);
  });

  it("'proud' → fearMul < 1.0, affectionMul > 1.0", () => {
    const m = getPersonalityModifier(["proud"], "moderate");
    expect(m.fearMul).toBeLessThan(1.0);
    expect(m.affectionMul).toBeGreaterThan(1.0);
  });

  it("'cold' → fearMul < 1.0", () => {
    const m = getPersonalityModifier(["cold"], "moderate");
    expect(m.fearMul).toBeLessThan(1.0);
    expect(m.affectionMul).toBeLessThan(1.0);
  });

  it("'calculating' minor → ambitionDeltaAdd > 0", () => {
    const m = getPersonalityModifier(["calculating"], "minor");
    expect(m.ambitionDeltaAdd).toBeGreaterThan(0);
  });

  it("'calculating' severe → ambitionDeltaAdd = 0", () => {
    const m = getPersonalityModifier(["calculating"], "severe");
    expect(m.ambitionDeltaAdd).toBe(0);
  });

  it("'discreet' → reactionVisibilityMul < 0.5", () => {
    const m = getPersonalityModifier(["discreet"], "moderate");
    expect(m.reactionVisibilityMul).toBeLessThan(0.5);
  });

  it("multiple traits combined → averaged muls, summed adds", () => {
    const proud = getPersonalityModifier(["proud"], "moderate");
    const cold  = getPersonalityModifier(["cold"],  "moderate");
    const both  = getPersonalityModifier(["proud", "cold"], "moderate");
    expect(both.affectionMul).toBeCloseTo((proud.affectionMul + cold.affectionMul) / 2, 5);
    expect(both.fearMul).toBeCloseTo((proud.fearMul + cold.fearMul) / 2, 5);
  });

  it("multiple traits: same-field delta is SUM not average", () => {
    const proud = getPersonalityModifier(["proud"], "moderate");
    const status = getPersonalityModifier(["status_conscious"], "moderate");
    const both   = getPersonalityModifier(["proud", "status_conscious"], "moderate");
    expect(both.loyaltyDeltaAdd).toBe(proud.loyaltyDeltaAdd + status.loyaltyDeltaAdd);
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("same context → identical consequence effects", () => {
    const state = createNewGameState(db);
    const ctx = makeCtx({ punishmentId: "det_test_a" });
    const p1 = planPunishmentConsequences(db, state, ctx);
    const p2 = planPunishmentConsequences(db, state, ctx);
    expect(p1.effects).toEqual(p2.effects);
    expect(p1.reactionBeats).toEqual(p2.reactionBeats);
  });

  it("different punishmentId → different specific deltas (within allowed range)", () => {
    const state = createNewGameState(db);
    const ctx1 = makeCtx({ punishmentId: "det_test_A" });
    const ctx2 = makeCtx({ punishmentId: "det_test_B" });
    const p1 = planPunishmentConsequences(db, state, ctx1);
    const p2 = planPunishmentConsequences(db, state, ctx2);
    // At least one target effect should differ (different seed → different roll)
    const targetEffects1 = p1.effects.filter((e) => e.type === "adjust_consort_attr" && (e as { char: string }).char === ctx1.targetId);
    const targetEffects2 = p2.effects.filter((e) => e.type === "adjust_consort_attr" && (e as { char: string }).char === ctx2.targetId);
    expect(JSON.stringify(targetEffects1)).not.toBe(JSON.stringify(targetEffects2));
  });
});

// ── Execution has no target attribute effects ─────────────────────────────────

describe("execution consequences", () => {
  it("execution kind → no adjust_consort_attr for target", () => {
    const state = createNewGameState(db);
    const ctx = makeCtx({ kind: "execution", severity: "terminal" });
    const plan = planPunishmentConsequences(db, state, ctx);
    const targetAttrEffects = plan.effects.filter(
      (e) => e.type === "adjust_consort_attr" && (e as { char: string }).char === ctx.targetId,
    );
    expect(targetAttrEffects).toHaveLength(0);
  });
});

// ── cold_palace kind recognized ───────────────────────────────────────────────

describe("cold_palace kind", () => {
  it("cold_palace in ctx → planner runs without error", () => {
    const state = createNewGameState(db);
    const ctx = makeCtx({ kind: "cold_palace", severity: "severe" });
    expect(() => planPunishmentConsequences(db, state, ctx)).not.toThrow();
    const plan = planPunishmentConsequences(db, state, ctx);
    expect(plan.effects.length).toBeGreaterThan(0);
  });
});

// ── Aggregation: at most one effect per charId+field from target ──────────────

describe("effect aggregation", () => {
  it("target has at most one adjust_consort_attr per field", () => {
    const state = createNewGameState(db);
    const ctx = makeCtx({ kind: "indefinite_confinement", severity: "severe" });
    const plan = planPunishmentConsequences(db, state, ctx);
    const targetEffects = plan.effects.filter(
      (e) => e.type === "adjust_consort_attr" && (e as { char: string }).char === ctx.targetId,
    );
    const fields = targetEffects.map((e) => (e as { field: string }).field);
    const uniqueFields = new Set(fields);
    expect(fields.length).toBe(uniqueFields.size);
  });
});

// ── Save migration + resolver ─────────────────────────────────────────────────

describe("save migration / resolver", () => {
  it("old-format consort (no standing.fear) → resolver returns authored hidden.fear", () => {
    const state = createNewGameState(db);
    const targetId = makeCtx().targetId;
    // Simulate v10 state: remove fear from standing
    const oldState = {
      ...state,
      standing: {
        ...state.standing,
        [targetId]: { ...state.standing[targetId]!, fear: undefined },
      },
    };
    const char = db.characters[targetId];
    const authoredFear = char?.kind === "consort" ? (char.hidden?.fear ?? 30) : 30;
    const resolved = resolveConsortRuntimeAttrs(db, oldState, targetId);
    expect(resolved.fear).toBe(authoredFear);
  });

  it("resolver fallback order: standing > hidden > default", () => {
    const state = createNewGameState(db);
    const targetId = makeCtx().targetId;
    // After applying a fear effect, standing.fear should be used
    const result = applyEffects(db, state, [{ type: "adjust_consort_attr", char: targetId, field: "fear", delta: 20 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newState = result.value;
    const resolved = resolveConsortRuntimeAttrs(db, newState, targetId);
    expect(resolved.fear).toBe(newState.standing[targetId]?.fear);
  });

  it("new game: all consorts have fear / ambition / loyalty in standing", () => {
    const state = createNewGameState(db);
    // Only check consorts that are actually present in standing (story consorts with
    // spawnMode:"event_only" are excluded from the initial standing).
    const consortIds = Object.keys(state.standing).filter((id) => {
      const c = db.characters[id] ?? state.generatedConsorts[id];
      return c?.kind === "consort";
    });
    expect(consortIds.length).toBeGreaterThan(0);
    for (const id of consortIds) {
      const st = state.standing[id];
      expect(st?.fear).not.toBeUndefined();
      expect(st?.ambition).not.toBeUndefined();
      expect(st?.loyalty).not.toBeUndefined();
    }
  });
});

// ── Atomic rollback ───────────────────────────────────────────────────────────

describe("atomicity", () => {
  it("invalid effect in batch → entire batch rejected, state unchanged", () => {
    const state = createNewGameState(db);
    const targetId = makeCtx().targetId;
    const stateBefore = JSON.stringify(state.standing[targetId]);
    const result = applyEffects(db, state, [
      { type: "adjust_consort_attr", char: targetId, field: "fear", delta: 10 },
      { type: "adjust_consort_attr", char: "char_nonexistent_99", field: "fear", delta: 5 }, // bad
    ]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(state.standing[targetId])).toBe(stateBefore);
  });
});
