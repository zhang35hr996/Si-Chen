/**
 * PUNISH-4E: Cold-palace intervention scheduling, eligibility, and store command tests.
 *
 * Covers:
 *  - Constants: COLD_PALACE_INTERVENTION_AP_COST, COLD_PALACE_VISIT_FAVOR_DELTA, COLD_PALACE_PHYSICIAN_HEALTH_DELTA
 *  - coldPalaceInterventionId: deterministic format
 *  - hasIntervenedThisMonth: month-scoped deduplication
 *  - canInterveneInColdPalace: active resident, active effect, AP check, deduplication
 *  - planColdPalaceIntervention: returns correct record for each kind
 *  - interveneInColdPalace (store): atomicity, AP deduction, state mutation, emit
 *  - interveneInColdPalace: idempotent failure when already intervened
 *  - interveneInColdPalace: reject when no AP
 *  - interveneInColdPalace: reject when not in cold palace
 *  - interveneInColdPalace: reject when deceased
 *  - validator: duplicate ID, wrong sign deltas, mismatched effectId
 */
import { describe, expect, it, vi } from "vitest";
import { createGameStore } from "../../../src/store/gameStore";
import type { GameState } from "../../../src/engine/state/types";
import {
  canInterveneInColdPalace,
  coldPalaceInterventionId,
  hasIntervenedThisMonth,
  planColdPalaceIntervention,
  COLD_PALACE_INTERVENTION_AP_COST,
  COLD_PALACE_VISIT_FAVOR_DELTA,
  COLD_PALACE_PHYSICIAN_HEALTH_DELTA,
} from "../../../src/engine/characters/coldPalaceIncidents";
import { validateColdPalaceInterventionLinks } from "../../../src/engine/characters/coldPalaceValidator";
import { loadRealContent } from "../../helpers/contentFixture";
import { createNewGameState } from "../../../src/engine/state/newGame";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";

function baseState(): GameState {
  return createNewGameState(db);
}

function stateWithColdPalaceResident(charId = REAL_TARGET_ID, health = 80): GameState {
  const store = createGameStore();
  store.loadState(baseState());
  const r = store.sendConsortToColdPalace(db, charId, {});
  expect(r.ok).toBe(true);
  const state = store.getState();
  return {
    ...state,
    standing: {
      ...state.standing,
      [charId]: { ...state.standing[charId]!, health },
    },
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("COLD_PALACE_INTERVENTION_AP_COST is 1", () => {
    expect(COLD_PALACE_INTERVENTION_AP_COST).toBe(1);
  });

  it("COLD_PALACE_VISIT_FAVOR_DELTA is 5", () => {
    expect(COLD_PALACE_VISIT_FAVOR_DELTA).toBe(5);
  });

  it("COLD_PALACE_PHYSICIAN_HEALTH_DELTA is 10", () => {
    expect(COLD_PALACE_PHYSICIAN_HEALTH_DELTA).toBe(10);
  });
});

// ── coldPalaceInterventionId ──────────────────────────────────────────────────

describe("coldPalaceInterventionId", () => {
  it("returns cpa_{charId}_{year}_{MM}", () => {
    expect(coldPalaceInterventionId("abc", 3, 7)).toBe("cpa_abc_3_07");
  });

  it("pads single-digit month to two digits", () => {
    expect(coldPalaceInterventionId("x", 1, 1)).toBe("cpa_x_1_01");
  });

  it("does not pad two-digit month", () => {
    expect(coldPalaceInterventionId("x", 1, 12)).toBe("cpa_x_1_12");
  });
});

// ── hasIntervenedThisMonth ────────────────────────────────────────────────────

describe("hasIntervenedThisMonth", () => {
  const baseEffect = {
    id: "cpa_x_1_01",
    residentId: "x",
    effectId: "e1",
    kind: "personal_visit" as const,
    occurredAt: { year: 1, month: 1, period: "early" as const, dayIndex: 0 },
    favorDelta: 5,
  };

  it("returns false for empty array", () => {
    expect(hasIntervenedThisMonth([], "x", 1, 1)).toBe(false);
  });

  it("returns true when matching intervention exists", () => {
    expect(hasIntervenedThisMonth([baseEffect], "x", 1, 1)).toBe(true);
  });

  it("returns false for different resident", () => {
    expect(hasIntervenedThisMonth([baseEffect], "y", 1, 1)).toBe(false);
  });

  it("returns false for different month", () => {
    expect(hasIntervenedThisMonth([baseEffect], "x", 1, 2)).toBe(false);
  });

  it("returns false for different year", () => {
    expect(hasIntervenedThisMonth([baseEffect], "x", 2, 1)).toBe(false);
  });
});

// ── canInterveneInColdPalace ──────────────────────────────────────────────────

describe("canInterveneInColdPalace", () => {
  it("returns true for eligible resident with AP available", () => {
    const state = stateWithColdPalaceResident();
    expect(state.calendar.ap).toBeGreaterThanOrEqual(1);
    expect(canInterveneInColdPalace(state, REAL_TARGET_ID, "personal_visit")).toBe(true);
    expect(canInterveneInColdPalace(state, REAL_TARGET_ID, "physician")).toBe(true);
  });

  it("returns false when resident not in cold palace", () => {
    const state = baseState();
    expect(canInterveneInColdPalace(state, REAL_TARGET_ID, "personal_visit")).toBe(false);
  });

  it("returns false when resident is deceased", () => {
    const state = stateWithColdPalaceResident();
    const modified = {
      ...state,
      standing: {
        ...state.standing,
        [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, lifecycle: "deceased" as const },
      },
    };
    expect(canInterveneInColdPalace(modified, REAL_TARGET_ID, "personal_visit")).toBe(false);
  });

  it("returns false when AP is 0", () => {
    const state = stateWithColdPalaceResident();
    const noAp = { ...state, calendar: { ...state.calendar, ap: 0 } };
    expect(canInterveneInColdPalace(noAp, REAL_TARGET_ID, "personal_visit")).toBe(false);
  });

  it("returns false when already intervened this month", () => {
    const state = stateWithColdPalaceResident();
    const effectId = state.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )?.id ?? "dummy";
    const { year, month, period, dayIndex } = state.calendar;
    const withRecord = {
      ...state,
      coldPalaceInterventions: [{
        id: coldPalaceInterventionId(REAL_TARGET_ID, year, month),
        residentId: REAL_TARGET_ID,
        effectId,
        kind: "personal_visit" as const,
        occurredAt: { year, month, period, dayIndex },
        favorDelta: 5,
      }],
    };
    expect(canInterveneInColdPalace(withRecord, REAL_TARGET_ID, "personal_visit")).toBe(false);
  });

  it("returns false for unknown charId", () => {
    const state = baseState();
    expect(canInterveneInColdPalace(state, "nonexistent_char", "personal_visit")).toBe(false);
  });
});

// ── planColdPalaceIntervention ────────────────────────────────────────────────

describe("planColdPalaceIntervention", () => {
  it("personal_visit returns correct record", () => {
    const state = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(state, REAL_TARGET_ID, "personal_visit");
    expect(plan.kind).toBe("personal_visit");
    expect(plan.residentId).toBe(REAL_TARGET_ID);
    if (plan.kind === "personal_visit") {
      expect(plan.favorDelta).toBe(COLD_PALACE_VISIT_FAVOR_DELTA);
    }
    expect(plan.id).toBe(coldPalaceInterventionId(REAL_TARGET_ID, state.calendar.year, state.calendar.month));
  });

  it("physician returns correct record", () => {
    const state = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(state, REAL_TARGET_ID, "physician");
    expect(plan.kind).toBe("physician");
    if (plan.kind === "physician") {
      expect(plan.healthDelta).toBe(COLD_PALACE_PHYSICIAN_HEALTH_DELTA);
    }
  });

  it("ID is deterministic for same month", () => {
    const state = stateWithColdPalaceResident();
    const a = planColdPalaceIntervention(state, REAL_TARGET_ID, "personal_visit");
    const b = planColdPalaceIntervention(state, REAL_TARGET_ID, "physician");
    expect(a.id).toBe(b.id);
  });

  it("effectId matches the active cold palace effect", () => {
    const state = stateWithColdPalaceResident();
    const activeEffect = state.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    );
    expect(activeEffect).toBeDefined();
    const plan = planColdPalaceIntervention(state, REAL_TARGET_ID, "personal_visit");
    expect(plan.effectId).toBe(activeEffect!.id);
  });
});

// ── interveneInColdPalace (store command) ─────────────────────────────────────

describe("interveneInColdPalace (store)", () => {
  function setupStore(health = 80) {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(r.ok).toBe(true);
    if (health !== 80) {
      const s = store.getState();
      store.loadState({
        ...s,
        standing: { ...s.standing, [REAL_TARGET_ID]: { ...s.standing[REAL_TARGET_ID]!, health } },
      });
    }
    return store;
  }

  it("personal_visit: appends intervention record and adjusts favor", () => {
    const store = setupStore();
    const before = store.getState();
    const beforeFavor = before.standing[REAL_TARGET_ID]?.favor ?? 0;
    const beforeAp = before.calendar.ap;

    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(result.ok).toBe(true);

    const after = store.getState();
    expect(after.coldPalaceInterventions).toHaveLength(1);
    const iv = after.coldPalaceInterventions[0]!;
    expect(iv.kind).toBe("personal_visit");
    expect(iv.residentId).toBe(REAL_TARGET_ID);
    if (iv.kind === "personal_visit") expect(iv.favorDelta).toBe(COLD_PALACE_VISIT_FAVOR_DELTA);

    expect(after.standing[REAL_TARGET_ID]?.favor ?? 0).toBe(
      Math.min(100, beforeFavor + COLD_PALACE_VISIT_FAVOR_DELTA),
    );
    expect(after.calendar.ap).toBe(beforeAp - COLD_PALACE_INTERVENTION_AP_COST);
  });

  it("physician: appends intervention record and increases health", () => {
    const store = setupStore(50);
    const before = store.getState();
    const beforeHealth = before.standing[REAL_TARGET_ID]?.health ?? 100;
    const beforeAp = before.calendar.ap;

    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "physician");
    expect(result.ok).toBe(true);

    const after = store.getState();
    expect(after.coldPalaceInterventions).toHaveLength(1);
    const iv = after.coldPalaceInterventions[0]!;
    expect(iv.kind).toBe("physician");
    if (iv.kind === "physician") expect(iv.healthDelta).toBe(COLD_PALACE_PHYSICIAN_HEALTH_DELTA);

    expect(after.standing[REAL_TARGET_ID]?.health ?? 0).toBeGreaterThan(beforeHealth);
    expect(after.calendar.ap).toBe(beforeAp - COLD_PALACE_INTERVENTION_AP_COST);
  });

  it("emits to subscribers exactly twice (resolveTimedAction + intervention append)", () => {
    const store = setupStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns error and no mutation when resident not in cold palace", () => {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const before = store.getState();
    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(result.ok).toBe(false);
    expect(store.getState().coldPalaceInterventions).toHaveLength(0);
    expect(store.getState().calendar.ap).toBe(before.calendar.ap);
  });

  it("returns error when already intervened this month", () => {
    const store = setupStore();
    const first = store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(first.ok).toBe(true);
    const second = store.interveneInColdPalace(db, REAL_TARGET_ID, "physician");
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.some((e) => e.message.includes("already received"))).toBe(true);
    expect(store.getState().coldPalaceInterventions).toHaveLength(1);
  });

  it("returns error when AP is exhausted", () => {
    const store = setupStore();
    const s = store.getState();
    store.loadState({ ...s, calendar: { ...s.calendar, ap: 0 } });
    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.some((e) => e.message.includes("AP"))).toBe(true);
  });

  it("returns error for deceased resident", () => {
    const store = setupStore();
    const s = store.getState();
    store.loadState({
      ...s,
      standing: {
        ...s.standing,
        [REAL_TARGET_ID]: { ...s.standing[REAL_TARGET_ID]!, lifecycle: "deceased" as const },
      },
    });
    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(result.ok).toBe(false);
  });

  it("physician is capped at health=100 (non-lethal recovery)", () => {
    const store = setupStore(95);
    store.interveneInColdPalace(db, REAL_TARGET_ID, "physician");
    const health = store.getState().standing[REAL_TARGET_ID]?.health ?? 0;
    expect(health).toBeLessThanOrEqual(100);
  });
});

// ── validateColdPalaceInterventionLinks ───────────────────────────────────────

describe("validateColdPalaceInterventionLinks", () => {
  function makeState(interventionOverrides: Partial<ReturnType<typeof planColdPalaceIntervention>> = {}): GameState {
    const base = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(base, REAL_TARGET_ID, "personal_visit");
    return {
      ...base,
      coldPalaceInterventions: [{ ...plan, ...interventionOverrides } as typeof plan],
    };
  }

  it("passes for valid personal_visit intervention", () => {
    const state = makeState();
    expect(validateColdPalaceInterventionLinks(state)).toHaveLength(0);
  });

  it("passes for valid physician intervention", () => {
    const base = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(base, REAL_TARGET_ID, "physician");
    const state = { ...base, coldPalaceInterventions: [plan] };
    expect(validateColdPalaceInterventionLinks(state)).toHaveLength(0);
  });

  it("rejects duplicate IDs", () => {
    const base = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(base, REAL_TARGET_ID, "personal_visit");
    const state = { ...base, coldPalaceInterventions: [plan, plan] };
    const errors = validateColdPalaceInterventionLinks(state);
    expect(errors.some((e) => e.message.includes("not unique"))).toBe(true);
  });

  it("rejects ID with wrong format", () => {
    const state = makeState({ id: "WRONG_FORMAT_123" } as never);
    const errors = validateColdPalaceInterventionLinks(state);
    expect(errors.some((e) => e.message.includes("canonical format"))).toBe(true);
  });

  it("rejects non-positive favorDelta for personal_visit", () => {
    const state = makeState({ favorDelta: 0 } as never);
    const errors = validateColdPalaceInterventionLinks(state);
    expect(errors.some((e) => e.message.includes("favorDelta"))).toBe(true);
  });

  it("rejects non-positive healthDelta for physician", () => {
    const base = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(base, REAL_TARGET_ID, "physician");
    const state = { ...base, coldPalaceInterventions: [{ ...plan, healthDelta: -5 }] };
    const errors = validateColdPalaceInterventionLinks(state);
    expect(errors.some((e) => e.message.includes("healthDelta"))).toBe(true);
  });

  it("rejects effectId not found in statusEffects", () => {
    const state = makeState({ effectId: "nonexistent_effect" } as never);
    const errors = validateColdPalaceInterventionLinks(state);
    expect(errors.some((e) => e.message.includes("effectId"))).toBe(true);
  });

  it("rejects intervention when effect was lifted before occurredAt", () => {
    const base = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(base, REAL_TARGET_ID, "personal_visit");
    // Simulate a lifted effect (liftedTurn = 0, intervention at dayIndex > 0)
    const liftedEffects = base.statusEffects.map((e) =>
      e.kind === "cold_palace" && e.id === plan.effectId
        ? { ...e, liftedTurn: 0 }
        : e,
    );
    const state = {
      ...base,
      statusEffects: liftedEffects,
      coldPalaceInterventions: [{ ...plan, occurredAt: { ...plan.occurredAt, dayIndex: 5 } }],
    };
    const errors = validateColdPalaceInterventionLinks(state);
    expect(errors.some((e) => e.message.includes("was not active"))).toBe(true);
  });

  it("rejects duplicate resident/month slot", () => {
    const base = stateWithColdPalaceResident();
    const plan = planColdPalaceIntervention(base, REAL_TARGET_ID, "personal_visit");
    const plan2 = { ...plan, id: plan.id + "_dup", kind: "physician" as const, healthDelta: 10 };
    delete (plan2 as Partial<typeof plan2> & { favorDelta?: number }).favorDelta;
    const state = { ...base, coldPalaceInterventions: [plan, plan2] };
    const errors = validateColdPalaceInterventionLinks(state);
    // id uniqueness OR resident/month duplicates should fire
    expect(errors.length).toBeGreaterThan(0);
  });
});
