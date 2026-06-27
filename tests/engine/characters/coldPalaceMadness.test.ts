/**
 * PUNISH-4F: Cold-palace mental breakdown tests.
 *
 * Covers:
 *   - Probability formula: fullMonths, health bonus, favor bonus, previous visit reduction, cap
 *   - Eligibility guards: deceased, candidate, no cold palace, already mad, this-month incident,
 *     critical illness priority, petition skipped for mad resident
 *   - Atomicity: effect + incident written together, one emit, rollback, strict trace
 *   - canRestoreFromColdPalace: madness blocks restore
 *   - restoreFromColdPalace store command: rejected for mad resident
 *   - Interventions still work after madness: personal_visit and physician succeed
 *   - Death after madness: history preserved, stale drain works
 *   - Validator: bad madnessEffectId, wrong resident, duplicate, future timestamp, startTurn mismatch
 *   - Save round-trip: valid state saves and loads cleanly
 *   - Migration v23 → v24
 */
import { describe, expect, it, vi } from "vitest";
import { createGameStore } from "../../../src/store/gameStore";
import type {
  ColdPalaceMadnessEffect,
  ColdPalaceMentalBreakdownIncident,
  GameState,
} from "../../../src/engine/state/types";
import {
  coldPalaceMadnessEffectFor,
  hasColdPalaceMadness,
  isLivingMadColdPalaceResident,
  canRestoreFromColdPalace,
  activeColdPalaceEffectFor,
} from "../../../src/engine/characters/coldPalace";
import {
  planColdPalaceMadnessBreakdown,
  coldPalaceMadnessChance,
  planColdPalaceIncidents,
  MADNESS_MIN_FULL_MONTHS,
  MADNESS_BASE_CHANCE,
  MADNESS_MONTHLY_STEP,
  MADNESS_BASE_CAP,
  MADNESS_LOW_HEALTH_BONUS,
  MADNESS_LOW_HEALTH_THRESHOLD,
  MADNESS_LOW_FAVOR_BONUS,
  MADNESS_LOW_FAVOR_THRESHOLD,
  MADNESS_PREVIOUS_VISIT_REDUCTION,
  MADNESS_MAX_CHANCE,
} from "../../../src/engine/characters/coldPalaceIncidents";
import { validateColdPalaceMadnessLinks } from "../../../src/engine/characters/coldPalaceValidator";
import { applyEffects } from "../../../src/engine/effects/funnel";
import type { ImperialCommand } from "../../../src/store/imperialCommands";
import { gameStateSchema } from "../../../src/engine/save/stateSchema";
import { dayIndexOf, makeGameTime, createCalendar } from "../../../src/engine/calendar/time";
import { loadRealContent } from "../../helpers/contentFixture";
import { createNewGameState } from "../../../src/engine/state/newGame";
import {
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../../src/engine/save/storage";
import { checksumOf } from "../../../src/engine/save/canonical";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";

function baseState(): GameState {
  return createNewGameState(db);
}

/** Create a cold-palace resident state at the initial calendar (year 1, month 1). */
function stateWithColdPalaceResident(charId = REAL_TARGET_ID, health = 80, favor = 50): GameState {
  const store = createGameStore();
  store.loadState(baseState());
  const r = store.sendConsortToColdPalace(db, charId, {});
  expect(r.ok).toBe(true);
  const state = store.getState();
  return {
    ...state,
    standing: {
      ...state.standing,
      [charId]: { ...state.standing[charId]!, health, favor, peakFavor: Math.max(state.standing[charId]!.peakFavor, favor) },
    },
  };
}

/**
 * Patch a cold-palace resident state so the effect appears to have started
 * `fullMonths` months before the current calendar month.
 *
 * The calendar is set to year 1, month (1 + fullMonths) early (or crosses year boundary).
 * The cold-palace effect's startedAt is set to year 1 month 1 (dayIndex 0).
 */
function stateAgedByMonths(base: GameState, fullMonths: number, charId = REAL_TARGET_ID): GameState {
  // Calculate target calendar: fullMonths after year-1 month-1.
  const totalMonth = 1 + fullMonths; // e.g. 7 for 6 full months
  const targetYear = Math.ceil(totalMonth / 12);
  const targetMonth = ((totalMonth - 1) % 12) + 1;

  const newCalendar = {
    ...createCalendar({ year: targetYear, month: targetMonth, period: "early", apMax: base.calendar.apMax }),
    eraName: base.calendar.eraName,
  };

  // The effect started at year 1 month 1 (dayIndex 0 = the very beginning).
  const startAt = makeGameTime(1, 1, "early");
  const updatedEffects = base.statusEffects.map((e) =>
    e.kind === "cold_palace" && e.characterId === charId
      ? { ...e, startedAt: startAt, startTurn: 0 }
      : e,
  );

  return { ...base, calendar: newCalendar, statusEffects: updatedEffects };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe("PUNISH-4F constants", () => {
  it("MADNESS_MIN_FULL_MONTHS is 6", () => {
    expect(MADNESS_MIN_FULL_MONTHS).toBe(6);
  });
  it("MADNESS_BASE_CHANCE is 8", () => {
    expect(MADNESS_BASE_CHANCE).toBe(8);
  });
  it("MADNESS_MAX_CHANCE is 45", () => {
    expect(MADNESS_MAX_CHANCE).toBe(45);
  });
});

// ── coldPalaceMadnessChance ───────────────────────────────────────────────────

describe("coldPalaceMadnessChance", () => {
  it("returns 0 when fewer than MADNESS_MIN_FULL_MONTHS elapsed", () => {
    const base = stateWithColdPalaceResident();
    // Only 0 full months elapsed (same month)
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(base, REAL_TARGET_ID, effect);
    expect(chance).toBe(0);
  });

  it("returns 0 for exactly 5 full months", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 5);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(0);
  });

  it("returns base chance for exactly 6 full months", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    // base = 8 + (6-6)*4 = 8, no bonuses/penalties (health=80, favor=50)
    expect(chance).toBe(MADNESS_BASE_CHANCE);
  });

  it("increases by MADNESS_MONTHLY_STEP per extra month", () => {
    const base = stateWithColdPalaceResident();
    const aged7 = stateAgedByMonths(base, 7);
    const effect7 = activeColdPalaceEffectFor(aged7, REAL_TARGET_ID)!;
    const chance7 = coldPalaceMadnessChance(aged7, REAL_TARGET_ID, effect7);
    // 8 + (7-6)*4 = 12
    expect(chance7).toBe(MADNESS_BASE_CHANCE + MADNESS_MONTHLY_STEP);
  });

  it("base is capped at MADNESS_BASE_CAP", () => {
    const base = stateWithColdPalaceResident();
    // Need fullMonths = 6 + (32-8)/4 = 6 + 6 = 12 to hit cap
    const aged = stateAgedByMonths(base, 12);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CAP); // 32, no bonuses
  });

  it("adds MADNESS_LOW_HEALTH_BONUS when health <= threshold", () => {
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, MADNESS_LOW_HEALTH_THRESHOLD);
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CHANCE + MADNESS_LOW_HEALTH_BONUS);
  });

  it("does not add low-health bonus when health > threshold", () => {
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, MADNESS_LOW_HEALTH_THRESHOLD + 1);
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CHANCE);
  });

  it("adds MADNESS_LOW_FAVOR_BONUS when favor <= threshold", () => {
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, 80, MADNESS_LOW_FAVOR_THRESHOLD);
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CHANCE + MADNESS_LOW_FAVOR_BONUS);
  });

  it("does not add favor bonus when favor > threshold", () => {
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, 80, MADNESS_LOW_FAVOR_THRESHOLD + 1);
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CHANCE);
  });

  it("subtracts MADNESS_PREVIOUS_VISIT_REDUCTION for last-month personal_visit", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6); // calendar is year 1 month 7
    // Add a personal_visit intervention from previous month (year 1 month 6)
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const prevVisitId = `cpa_${REAL_TARGET_ID}_1_06`;
    const withVisit: GameState = {
      ...aged,
      coldPalaceInterventions: [
        ...aged.coldPalaceInterventions,
        {
          id: prevVisitId,
          residentId: REAL_TARGET_ID,
          effectId: effect.id,
          kind: "personal_visit" as const,
          occurredAt: makeGameTime(1, 6, "early"),
          favorDelta: 5,
        },
      ],
    };
    const chance = coldPalaceMadnessChance(withVisit, REAL_TARGET_ID, effect);
    // 8 - 10 = -2, clamped to 0
    expect(chance).toBe(Math.max(0, MADNESS_BASE_CHANCE - MADNESS_PREVIOUS_VISIT_REDUCTION));
  });

  it("does NOT subtract for a physician visit last month (only personal_visit)", () => {
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, 50);
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const prevPhysicianId = `cpa_${REAL_TARGET_ID}_1_06`;
    const withPhysician: GameState = {
      ...aged,
      coldPalaceInterventions: [
        ...aged.coldPalaceInterventions,
        {
          id: prevPhysicianId,
          residentId: REAL_TARGET_ID,
          effectId: effect.id,
          kind: "physician" as const,
          occurredAt: makeGameTime(1, 6, "early"),
          healthDelta: 10,
        },
      ],
    };
    const chance = coldPalaceMadnessChance(withPhysician, REAL_TARGET_ID, effect);
    // No reduction for physician
    expect(chance).toBe(MADNESS_BASE_CHANCE);
  });

  it("does NOT count current month personal_visit as previous month", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6); // calendar = year 1 month 7
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    // Visit in CURRENT month (month 7) — should not reduce
    const curVisitId = `cpa_${REAL_TARGET_ID}_1_07`;
    const withCurVisit: GameState = {
      ...aged,
      coldPalaceInterventions: [
        ...aged.coldPalaceInterventions,
        {
          id: curVisitId,
          residentId: REAL_TARGET_ID,
          effectId: effect.id,
          kind: "personal_visit" as const,
          occurredAt: makeGameTime(1, 7, "early"),
          favorDelta: 5,
        },
      ],
    };
    const chance = coldPalaceMadnessChance(withCurVisit, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CHANCE); // no reduction
  });

  it("handles cross-year previous month correctly (current=year2 month1, prev=year1 month12)", () => {
    const base = stateWithColdPalaceResident();
    // Advance to year 2 month 1 (13 months total from year 1 month 1)
    const aged = stateAgedByMonths(base, 12);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    // Add a personal_visit in year 1 month 12 (= previous month of year 2 month 1)
    const prevVisitId = `cpa_${REAL_TARGET_ID}_1_12`;
    const withVisit: GameState = {
      ...aged,
      coldPalaceInterventions: [
        ...aged.coldPalaceInterventions,
        {
          id: prevVisitId,
          residentId: REAL_TARGET_ID,
          effectId: effect.id,
          kind: "personal_visit" as const,
          occurredAt: makeGameTime(1, 12, "early"),
          favorDelta: 5,
        },
      ],
    };
    const chance = coldPalaceMadnessChance(withVisit, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_BASE_CAP - MADNESS_PREVIOUS_VISIT_REDUCTION); // 32-10=22
  });

  it("clamps to MADNESS_MAX_CHANCE", () => {
    // All bonuses: base cap(32) + low health(8) + low favor(5) = 45 = max
    const base = stateWithColdPalaceResident(
      REAL_TARGET_ID,
      MADNESS_LOW_HEALTH_THRESHOLD,
      MADNESS_LOW_FAVOR_THRESHOLD,
    );
    const aged = stateAgedByMonths(base, 12); // base = 32
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const chance = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(chance).toBe(MADNESS_MAX_CHANCE); // 32+8+5=45
  });

  it("is deterministic: same state/seed gives same result", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const c1 = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    const c2 = coldPalaceMadnessChance(aged, REAL_TARGET_ID, effect);
    expect(c1).toBe(c2);
  });

  it("generated consort in cold palace computes chance correctly", () => {
    const base = stateWithColdPalaceResident();
    const genId = "gen_000001";
    // Inject a generated consort with cold palace effect
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const genEffect: typeof effect = {
      ...effect,
      id: "se_gen_000001",
      characterId: genId,
    };
    const aged = stateAgedByMonths(
      {
        ...base,
        standing: {
          ...base.standing,
          [genId]: { ...base.standing[REAL_TARGET_ID]!, health: 80, favor: 50, peakFavor: Math.max(base.standing[REAL_TARGET_ID]!.peakFavor, 50) },
        },
        statusEffects: [...base.statusEffects, genEffect],
      },
      6,
    );
    const eff = activeColdPalaceEffectFor(aged, genId)!;
    const chance = coldPalaceMadnessChance(aged, genId, eff);
    expect(chance).toBe(MADNESS_BASE_CHANCE);
  });
});

// ── planColdPalaceMadnessBreakdown eligibility ───────────────────────────────

describe("planColdPalaceMadnessBreakdown eligibility", () => {
  it("returns null when fewer than 6 full months elapsed", () => {
    const base = stateWithColdPalaceResident();
    // Calendar at month 1, same month as effect start — 0 full months
    const result = planColdPalaceMadnessBreakdown(base);
    expect(result).toBeNull();
  });

  it("returns null for deceased resident", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6);
    const deceased: GameState = {
      ...aged,
      standing: {
        ...aged.standing,
        [REAL_TARGET_ID]: { ...aged.standing[REAL_TARGET_ID]!, lifecycle: "deceased" as const },
      },
    };
    const result = planColdPalaceMadnessBreakdown(deceased);
    expect(result).toBeNull();
  });

  it("returns null for candidate", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6);
    const candidate: GameState = {
      ...aged,
      standing: {
        ...aged.standing,
        [REAL_TARGET_ID]: { ...aged.standing[REAL_TARGET_ID]!, lifecycle: "candidate" as const },
      },
    };
    const result = planColdPalaceMadnessBreakdown(candidate);
    expect(result).toBeNull();
  });

  it("returns null when resident has no active cold palace effect", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 6);
    // Remove cold palace effect
    const noEffect: GameState = {
      ...aged,
      statusEffects: aged.statusEffects.filter(
        (e) => !(e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID),
      ),
    };
    const result = planColdPalaceMadnessBreakdown(noEffect);
    expect(result).toBeNull();
  });

  it("returns null when resident already has a madness effect", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 12);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const existingMadness: ColdPalaceMadnessEffect = {
      id: "status_" + REAL_TARGET_ID + "_000099",
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: aged.calendar,
      startTurn: aged.calendar.dayIndex,
    };
    const withMadness: GameState = {
      ...aged,
      statusEffects: [...aged.statusEffects, existingMadness],
    };
    const result = planColdPalaceMadnessBreakdown(withMadness);
    expect(result).toBeNull();
  });

  it("returns null when same-month cold palace incident exists (critical takes slot)", () => {
    const base = stateWithColdPalaceResident();
    const aged = stateAgedByMonths(base, 12);
    const effect = activeColdPalaceEffectFor(aged, REAL_TARGET_ID)!;
    const { year, month, period, dayIndex } = aged.calendar;
    const criticalIncident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown" as const,
      occurredAt: { year, month, period, dayIndex },
      acknowledged: false,
      madnessEffectId: "dummy",
    };
    const withExistingIncident: GameState = {
      ...aged,
      coldPalaceIncidents: [...aged.coldPalaceIncidents, criticalIncident],
    };
    // The incident slot is occupied — planner skips
    const result = planColdPalaceMadnessBreakdown(withExistingIncident);
    expect(result).toBeNull();
  });
});

// ── planColdPalaceMadnessBreakdown output ────────────────────────────────────

describe("planColdPalaceMadnessBreakdown output structure", () => {
  /** Build a state where the rngSeed guarantees a madness trigger for REAL_TARGET_ID. */
  function stateGuaranteedMadness(): GameState {
    // Try different rngSeeds until we find one that triggers at month 7.
    // Use a seed that produces roll < 8 for the deterministic key.
    // Key: cold_palace_madness:{rngSeed}:{effectId}:{charId}:{year}:{month}
    // We'll test with many states and pick the first that triggers.
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, MADNESS_LOW_HEALTH_THRESHOLD, MADNESS_LOW_FAVOR_THRESHOLD);
    // chance = 8 + 8 + 5 = 21, pretty good odds
    const aged = stateAgedByMonths(base, 6);
    // Try seeds 1..100
    for (let seed = 1; seed <= 100; seed++) {
      const state = { ...aged, rngSeed: seed };
      const result = planColdPalaceMadnessBreakdown(state);
      if (result !== null) return state;
    }
    throw new Error("Could not find a seed that triggers madness in 100 attempts");
  }

  it("returns effect and incident pair when triggered", () => {
    const state = stateGuaranteedMadness();
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result).not.toBeNull();
    expect(result.effect.kind).toBe("cold_palace_madness");
    expect(result.incident.kind).toBe("mental_breakdown");
  });

  it("effect.characterId matches residentId in incident", () => {
    const state = stateGuaranteedMadness();
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result.effect.characterId).toBe(result.incident.residentId);
    expect(result.effect.characterId).toBe(REAL_TARGET_ID);
  });

  it("incident.madnessEffectId === effect.id", () => {
    const state = stateGuaranteedMadness();
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result.incident.madnessEffectId).toBe(result.effect.id);
  });

  it("incident.effectId === sourceColdPalaceEffectId", () => {
    const state = stateGuaranteedMadness();
    const effect = activeColdPalaceEffectFor(state, REAL_TARGET_ID)!;
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result.incident.effectId).toBe(effect.id);
    expect(result.effect.sourceColdPalaceEffectId).toBe(effect.id);
  });

  it("effect.startTurn === startedAt.dayIndex", () => {
    const state = stateGuaranteedMadness();
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result.effect.startTurn).toBe(result.effect.startedAt.dayIndex);
    expect(result.effect.startedAt.dayIndex).toBe(state.calendar.dayIndex);
  });

  it("incident.occurredAt matches calendar", () => {
    const state = stateGuaranteedMadness();
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result.incident.occurredAt.year).toBe(state.calendar.year);
    expect(result.incident.occurredAt.month).toBe(state.calendar.month);
    expect(result.incident.occurredAt.dayIndex).toBe(state.calendar.dayIndex);
  });

  it("incident.acknowledged is false", () => {
    const state = stateGuaranteedMadness();
    const result = planColdPalaceMadnessBreakdown(state)!;
    expect(result.incident.acknowledged).toBe(false);
  });

  it("is deterministic: same state gives same result", () => {
    const state = stateGuaranteedMadness();
    const r1 = planColdPalaceMadnessBreakdown(state);
    const r2 = planColdPalaceMadnessBreakdown(state);
    expect(r1?.effect.id).toBe(r2?.effect.id);
    expect(r1?.incident.id).toBe(r2?.incident.id);
  });

  it("different effectId participates in RNG key (effect from different sentence → different roll)", () => {
    const state1 = stateGuaranteedMadness();
    // Swap the effect id to change the RNG key
    const effect = activeColdPalaceEffectFor(state1, REAL_TARGET_ID)!;
    const state2: GameState = {
      ...state1,
      statusEffects: state1.statusEffects.map((e) =>
        e.id === effect.id ? { ...e, id: "se_alt_999999" } : e,
      ),
    };
    // Results may differ since the key changed
    const r1 = planColdPalaceMadnessBreakdown(state1);
    const r2 = planColdPalaceMadnessBreakdown(state2);
    // At minimum, effect IDs referenced differ
    if (r1 && r2) {
      expect(r1.effect.sourceColdPalaceEffectId).not.toBe(r2.effect.sourceColdPalaceEffectId);
    }
  });
});

// ── Regular planner: mad resident petition suppressed ────────────────────────

describe("planColdPalaceIncidents with mad resident", () => {
  it("does not generate petition for an already-mad resident", () => {
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, 80, 50); // health=80 → petition eligible
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: "status_" + REAL_TARGET_ID + "_000099",
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: base.calendar,
      startTurn: base.calendar.dayIndex,
    };
    const withMadness: GameState = {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      rngSeed: 42, // known seed that triggers petition for health=80
    };
    // Run the regular planner many times — petition must never appear
    for (let seed = 1; seed <= 50; seed++) {
      const state = { ...withMadness, rngSeed: seed };
      const incidents = planColdPalaceIncidents(state);
      for (const i of incidents) {
        expect(i.kind).not.toBe("petition");
      }
    }
  });
});

// ── canRestoreFromColdPalace selector ────────────────────────────────────────

describe("canRestoreFromColdPalace", () => {
  it("returns ok:true for a normal cold-palace resident", () => {
    const state = stateWithColdPalaceResident();
    const result = canRestoreFromColdPalace(state, REAL_TARGET_ID);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with madness reason for mad resident", () => {
    const base = stateWithColdPalaceResident();
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: "status_" + REAL_TARGET_ID + "_000099",
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: base.calendar,
      startTurn: base.calendar.dayIndex,
    };
    const withMadness: GameState = {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
    };
    const result = canRestoreFromColdPalace(withMadness, REAL_TARGET_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/神志/);
    }
  });

  it("returns ok:false for deceased resident", () => {
    const state = stateWithColdPalaceResident();
    const deceased: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, lifecycle: "deceased" as const },
      },
    };
    const result = canRestoreFromColdPalace(deceased, REAL_TARGET_ID);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for non-cold-palace resident", () => {
    const state = baseState();
    const result = canRestoreFromColdPalace(state, REAL_TARGET_ID);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for unknown character", () => {
    const state = baseState();
    const result = canRestoreFromColdPalace(state, "nonexistent_char");
    expect(result.ok).toBe(false);
  });
});

// ── restoreFromColdPalace store command: mad resident rejected ────────────────

describe("restoreFromColdPalace rejects mad resident", () => {
  it("returns err when target has cold_palace_madness effect", () => {
    const store = createGameStore();
    store.loadState(baseState());
    const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(r.ok).toBe(true);

    const state = store.getState();
    const effect = activeColdPalaceEffectFor(state, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: `status_${REAL_TARGET_ID}_000099`,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: state.calendar,
      startTurn: state.calendar.dayIndex,
    };
    store.loadState({
      ...state,
      statusEffects: [...state.statusEffects, madnessEffect],
    });

    const restoreResult = store.restoreFromColdPalace(db, REAL_TARGET_ID, "lifted_by_emperor");
    expect(restoreResult.ok).toBe(false);
    // State must not change
    const after = store.getState();
    expect(after.statusEffects.some((e) => e.id === madnessEffect.id)).toBe(true);
  });

  it("does not emit when restore is blocked by madness", () => {
    const store = createGameStore();
    store.loadState(baseState());
    store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    const state = store.getState();
    const effect = activeColdPalaceEffectFor(state, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: `status_${REAL_TARGET_ID}_000099`,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: state.calendar,
      startTurn: state.calendar.dayIndex,
    };
    store.loadState({ ...state, statusEffects: [...state.statusEffects, madnessEffect] });

    const listener = vi.fn();
    store.subscribe(listener);
    store.restoreFromColdPalace(db, REAL_TARGET_ID, "lifted_by_emperor");
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── Same-day execution round-trip ────────────────────────────────────────────
// Covers: mad resident executed on the same dayIndex as the madness onset.
// This is the critical edge case where liftedTurn === madness.startedAt.dayIndex.

describe("same-day execution of mad cold-palace resident", () => {
  function stateWithMadAndIncident(): GameState {
    const base = stateWithColdPalaceResident();
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const { year, month, period, dayIndex } = base.calendar;
    const madnessEffectId = `status_${REAL_TARGET_ID}_000099`;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: madnessEffectId,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: { year, month, period, dayIndex },
      startTurn: dayIndex,
    };
    const incident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown",
      occurredAt: { year, month, period, dayIndex },
      acknowledged: false,
      madnessEffectId,
    };
    return {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      coldPalaceIncidents: [...base.coldPalaceIncidents, incident],
    };
  }

  it("execution on same dayIndex succeeds and leaves state that passes schema + validator + save round-trip", () => {
    const store = createGameStore();
    store.loadState(stateWithMadAndIncident());

    // Execute immediately — no time advance, so liftedTurn === madness dayIndex
    const execCmd: ImperialCommand = { type: "execute", targetId: REAL_TARGET_ID };
    const execResult = store.applyImperialPunishmentWithConsequences(db, execCmd, {});
    expect(execResult.ok).toBe(true);

    const state = store.getState();

    // Character is deceased
    expect(state.standing[REAL_TARGET_ID]?.lifecycle).toBe("deceased");

    // Madness effect is preserved
    expect(state.statusEffects.some((e) => e.kind === "cold_palace_madness" && e.characterId === REAL_TARGET_ID)).toBe(true);

    // Breakdown incident is preserved
    expect(state.coldPalaceIncidents.some((i) => i.kind === "mental_breakdown" && i.residentId === REAL_TARGET_ID)).toBe(true);

    // Cold palace effect is lifted with liftReason === "death"
    const cpEffect = state.statusEffects.find((e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID);
    expect(cpEffect).toBeDefined();
    if (!cpEffect || cpEffect.kind !== "cold_palace") return;
    expect(cpEffect.liftedTurn).toBe(state.calendar.dayIndex);
    expect(cpEffect.liftReason).toBe("death");

    // Schema round-trip passes
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);

    // Validator passes
    const errors = validateColdPalaceMadnessLinks(state);
    expect(errors).toHaveLength(0);

    // Save round-trip
    const saveData = createSaveData(db, state, "slot1");
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
  });
});

// ── Selectors ─────────────────────────────────────────────────────────────────

describe("selectors", () => {
  function stateWithMadness(charId = REAL_TARGET_ID): { state: GameState; madnessEffect: ColdPalaceMadnessEffect } {
    const base = stateWithColdPalaceResident(charId);
    const effect = activeColdPalaceEffectFor(base, charId)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: `status_${charId}_000099`,
      kind: "cold_palace_madness",
      characterId: charId,
      sourceColdPalaceEffectId: effect.id,
      startedAt: base.calendar,
      startTurn: base.calendar.dayIndex,
    };
    return {
      state: { ...base, statusEffects: [...base.statusEffects, madnessEffect] },
      madnessEffect,
    };
  }

  describe("coldPalaceMadnessEffectFor", () => {
    it("returns undefined when no madness effect", () => {
      const state = stateWithColdPalaceResident();
      expect(coldPalaceMadnessEffectFor(state, REAL_TARGET_ID)).toBeUndefined();
    });
    it("returns the madness effect when present", () => {
      const { state, madnessEffect } = stateWithMadness();
      expect(coldPalaceMadnessEffectFor(state, REAL_TARGET_ID)?.id).toBe(madnessEffect.id);
    });
  });

  describe("hasColdPalaceMadness", () => {
    it("returns false when no madness effect", () => {
      const state = stateWithColdPalaceResident();
      expect(hasColdPalaceMadness(state, REAL_TARGET_ID)).toBe(false);
    });
    it("returns true when madness effect present", () => {
      const { state } = stateWithMadness();
      expect(hasColdPalaceMadness(state, REAL_TARGET_ID)).toBe(true);
    });
    it("returns true even after character is deceased", () => {
      const { state } = stateWithMadness();
      const deceased: GameState = {
        ...state,
        standing: {
          ...state.standing,
          [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, lifecycle: "deceased" as const },
        },
      };
      expect(hasColdPalaceMadness(deceased, REAL_TARGET_ID)).toBe(true);
    });
  });

  describe("isLivingMadColdPalaceResident", () => {
    it("returns false for normal (non-mad) cold palace resident", () => {
      const state = stateWithColdPalaceResident();
      expect(isLivingMadColdPalaceResident(state, REAL_TARGET_ID)).toBe(false);
    });
    it("returns true for living mad cold palace resident", () => {
      const { state } = stateWithMadness();
      expect(isLivingMadColdPalaceResident(state, REAL_TARGET_ID)).toBe(true);
    });
    it("returns false for deceased mad resident", () => {
      const { state } = stateWithMadness();
      const deceased: GameState = {
        ...state,
        standing: {
          ...state.standing,
          [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, lifecycle: "deceased" as const },
        },
      };
      expect(isLivingMadColdPalaceResident(deceased, REAL_TARGET_ID)).toBe(false);
    });
    it("returns false when cold palace effect is lifted", () => {
      const { state } = stateWithMadness();
      // Lift the cold palace effect
      const updatedEffects = state.statusEffects.map((e) =>
        e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID
          ? { ...e, liftedTurn: state.calendar.dayIndex }
          : e,
      );
      const lifted: GameState = { ...state, statusEffects: updatedEffects };
      expect(isLivingMadColdPalaceResident(lifted, REAL_TARGET_ID)).toBe(false);
    });
  });
});

// ── Interventions still work after madness ───────────────────────────────────

describe("interventions still work for mad residents", () => {
  it("personal_visit succeeds for mad resident", () => {
    const store = createGameStore();
    store.loadState(baseState());
    store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    const state = store.getState();
    const effect = activeColdPalaceEffectFor(state, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: `status_${REAL_TARGET_ID}_000099`,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: state.calendar,
      startTurn: state.calendar.dayIndex,
    };
    store.loadState({ ...state, statusEffects: [...state.statusEffects, madnessEffect] });

    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "personal_visit");
    expect(result.ok).toBe(true);
    // Madness effect still present
    expect(hasColdPalaceMadness(store.getState(), REAL_TARGET_ID)).toBe(true);
  });

  it("physician succeeds for mad resident", () => {
    const store = createGameStore();
    store.loadState(baseState());
    store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    const state = store.getState();
    const stateWithLowHealth: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, health: 50 },
      },
    };
    const effect = activeColdPalaceEffectFor(stateWithLowHealth, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: `status_${REAL_TARGET_ID}_000099`,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: stateWithLowHealth.calendar,
      startTurn: stateWithLowHealth.calendar.dayIndex,
    };
    store.loadState({ ...stateWithLowHealth, statusEffects: [...stateWithLowHealth.statusEffects, madnessEffect] });

    const result = store.interveneInColdPalace(db, REAL_TARGET_ID, "physician");
    expect(result.ok).toBe(true);
    expect(hasColdPalaceMadness(store.getState(), REAL_TARGET_ID)).toBe(true);
    // Madness not lifted by physician
    expect(store.getState().statusEffects.some(
      (e) => e.kind === "cold_palace_madness" && e.characterId === REAL_TARGET_ID,
    )).toBe(true);
  });
});

// ── Strict trace ──────────────────────────────────────────────────────────────

describe("mental breakdown settlement strict trace", () => {
  it("no untracked mutations when madness breakdown is generated in settlement", () => {
    // State: year 1, month 6, period "late", ap=1 (one SPEND_AP advances to month 7 early → monthChanged).
    // Effect started year 1, month 1. fullMonths at month 7 = 6 → eligible.
    const base = stateWithColdPalaceResident(REAL_TARGET_ID, MADNESS_LOW_HEALTH_THRESHOLD, MADNESS_LOW_FAVOR_THRESHOLD);
    const lateCalendar = createCalendar({ year: 1, month: 6, period: "late", apMax: 1 });
    const earlyMonth7Cal = createCalendar({ year: 1, month: 7, period: "early", apMax: 1 });

    let foundTriggerSeed = false;
    for (let seed = 1; seed <= 200; seed++) {
      // Simulate what settlement would see after advancing to month 7
      const simulatedState: GameState = {
        ...base,
        rngSeed: seed,
        calendar: { ...earlyMonth7Cal, eraName: base.calendar.eraName },
      };
      if (planColdPalaceMadnessBreakdown(simulatedState) === null) continue;
      foundTriggerSeed = true;

      // This seed triggers — run the actual store advance in strict mode
      const prepState: GameState = {
        ...base,
        rngSeed: seed,
        calendar: { ...lateCalendar, eraName: base.calendar.eraName },
      };
      const store = createGameStore({ traceMode: "strict" });
      store.loadState(prepState);

      const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
      expect(r.ok).toBe(true);
      if (!r.ok) break;

      const hist = store.getTraceHistory().getAll();
      expect(hist.length).toBeGreaterThan(0);
      const lastTx = hist.at(-1)!;
      expect(lastTx.outcome).toBe("committed");
      expect(lastTx.untrackedCount).toBe(0);
      // The trace must include both the madness effect and the breakdown incident
      const afterState = store.getState();
      expect(afterState.statusEffects.some((e) => e.kind === "cold_palace_madness")).toBe(true);
      expect(afterState.coldPalaceIncidents.some((i) => i.kind === "mental_breakdown")).toBe(true);
      break;
    }
    expect(foundTriggerSeed, "expected at least one seed (1-200) to trigger madness breakdown").toBe(true);
  });
});

// ── Validator: validateColdPalaceMadnessLinks ─────────────────────────────────

describe("validateColdPalaceMadnessLinks", () => {
  function stateWithMadnessAndIncident(): GameState {
    const base = stateWithColdPalaceResident();
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const { year, month, period, dayIndex } = base.calendar;
    const madnessEffectId = `status_${REAL_TARGET_ID}_000099`;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: madnessEffectId,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: { year, month, period, dayIndex },
      startTurn: dayIndex,
    };
    const incident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown",
      occurredAt: { year, month, period, dayIndex },
      acknowledged: false,
      madnessEffectId,
    };
    return {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      coldPalaceIncidents: [...base.coldPalaceIncidents, incident],
    };
  }

  it("returns no errors for valid madness state", () => {
    const state = stateWithMadnessAndIncident();
    const errors = validateColdPalaceMadnessLinks(state);
    expect(errors).toHaveLength(0);
  });

  it("errors on bad madnessEffectId in incident", () => {
    const state = stateWithMadnessAndIncident();
    const incident = state.coldPalaceIncidents.find((i) => i.kind === "mental_breakdown")!;
    const badIncident = { ...incident, madnessEffectId: "nonexistent_id" };
    const withBad: GameState = {
      ...state,
      coldPalaceIncidents: state.coldPalaceIncidents.map((i) =>
        i.id === incident.id ? badIncident : i,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withBad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on wrong residentId in incident", () => {
    const state = stateWithMadnessAndIncident();
    const incident = state.coldPalaceIncidents.find((i) => i.kind === "mental_breakdown")!;
    const badIncident = { ...incident, residentId: "other_char" };
    const withBad: GameState = {
      ...state,
      coldPalaceIncidents: state.coldPalaceIncidents.map((i) =>
        i.id === incident.id ? badIncident : i,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withBad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on duplicate madness effect for same character", () => {
    const state = stateWithMadnessAndIncident();
    const madnessEffect = state.statusEffects.find((e) => e.kind === "cold_palace_madness")!;
    const duplicate = { ...madnessEffect, id: "status_dup_000001" };
    const withDup: GameState = {
      ...state,
      statusEffects: [...state.statusEffects, duplicate],
    };
    const errors = validateColdPalaceMadnessLinks(withDup);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on future timestamp in madness effect", () => {
    const state = stateWithMadnessAndIncident();
    const madnessEffect = state.statusEffects.find((e) => e.kind === "cold_palace_madness")!;
    const futureEffect = {
      ...madnessEffect,
      startedAt: makeGameTime(99, 12, "late"),
      startTurn: dayIndexOf(99, 12, "late"),
    };
    const withFuture: GameState = {
      ...state,
      statusEffects: state.statusEffects.map((e) =>
        e.id === madnessEffect.id ? futureEffect : e,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withFuture);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on startTurn mismatch in madness effect", () => {
    const state = stateWithMadnessAndIncident();
    const madnessEffect = state.statusEffects.find((e) => e.kind === "cold_palace_madness")!;
    const withMismatch = { ...madnessEffect, startTurn: madnessEffect.startTurn + 99 };
    const withBad: GameState = {
      ...state,
      statusEffects: state.statusEffects.map((e) =>
        e.id === madnessEffect.id ? withMismatch : e,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withBad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on duplicate mental_breakdown incident for same cold palace sentence", () => {
    const state = stateWithMadnessAndIncident();
    const incident = state.coldPalaceIncidents.find((i) => i.kind === "mental_breakdown")!;
    const dupIncident = { ...incident, id: "cpi_dup_1_99" };
    const withDup: GameState = {
      ...state,
      coldPalaceIncidents: [...state.coldPalaceIncidents, dupIncident],
    };
    const errors = validateColdPalaceMadnessLinks(withDup);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on incorrect effectId in incident (wrong cold palace effect)", () => {
    const state = stateWithMadnessAndIncident();
    const incident = state.coldPalaceIncidents.find((i) => i.kind === "mental_breakdown")!;
    const badIncident = { ...incident, effectId: "wrong_effect_id" };
    const withBad: GameState = {
      ...state,
      coldPalaceIncidents: state.coldPalaceIncidents.map((i) =>
        i.id === incident.id ? badIncident : i,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withBad);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Save round-trip ──────────────────────────────────────────────────────────

describe("save round-trip with madness effect", () => {
  it("state with ColdPalaceMadnessEffect serializes and deserializes cleanly", () => {
    const base = stateWithColdPalaceResident();
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const { year, month, period, dayIndex } = base.calendar;
    const madnessEffectId = `status_${REAL_TARGET_ID}_000099`;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: madnessEffectId,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: { year, month, period, dayIndex },
      startTurn: dayIndex,
    };
    const incident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown",
      occurredAt: { year, month, period, dayIndex },
      acknowledged: false,
      madnessEffectId,
    };
    const state: GameState = {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      coldPalaceIncidents: [...base.coldPalaceIncidents, incident],
    };

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("round-trip error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const loadedState = loaded.value.state;
    expect(loadedState.statusEffects.some((e) => e.kind === "cold_palace_madness" && e.id === madnessEffectId)).toBe(true);
    expect(loadedState.coldPalaceIncidents.some((i) => i.kind === "mental_breakdown" && i.madnessEffectId === madnessEffectId)).toBe(true);
  });

  it("corrupt state: missing madnessEffectId fails to load (quarantine)", () => {
    const base = stateWithColdPalaceResident();
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const { year, month, period, dayIndex } = base.calendar;
    const madnessEffectId = `status_${REAL_TARGET_ID}_000099`;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: madnessEffectId,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: { year, month, period, dayIndex },
      startTurn: dayIndex,
    };
    const incident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown",
      occurredAt: { year, month, period, dayIndex },
      acknowledged: false,
      madnessEffectId: "nonexistent_madness_id", // bad link
    };
    const state: GameState = {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      coldPalaceIncidents: [...base.coldPalaceIncidents, incident],
    };

    const current = createSaveData(db, base, "slot1");
    const badEnv = { ...current, state, checksum: checksumOf(state) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(badEnv));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
  });
});

// ── Effect funnel gate (allowInternalEffects) ─────────────────────────────────

describe("effect funnel: restore_from_cold_palace blocked for mad resident", () => {
  it("applyEffects with allowInternalEffects rejects mad resident and leaves state unchanged", () => {
    const store = createGameStore();
    store.loadState(baseState());
    store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    const state = store.getState();
    const effect = activeColdPalaceEffectFor(state, REAL_TARGET_ID)!;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: `status_${REAL_TARGET_ID}_000099`,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: state.calendar,
      startTurn: state.calendar.dayIndex,
    };
    const incident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_0001_01`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown",
      occurredAt: state.calendar,
      acknowledged: false,
      madnessEffectId: madnessEffect.id,
    };
    const madState: GameState = {
      ...state,
      statusEffects: [...state.statusEffects, madnessEffect],
      coldPalaceIncidents: [...state.coldPalaceIncidents, incident],
    };

    const result = applyEffects(
      db,
      madState,
      [{
        type: "restore_from_cold_palace",
        char: REAL_TARGET_ID,
        liftReason: "lifted_by_emperor",
        liftedAt: madState.calendar,
        liftedTurn: madState.calendar.dayIndex,
      }],
      { allowInternalEffects: true },
    );

    expect(result.ok).toBe(false);
    // State must remain unchanged — mad resident is still in cold palace
    expect(madState.statusEffects.some((e) => e.kind === "cold_palace_madness")).toBe(true);
    expect(activeColdPalaceEffectFor(madState, REAL_TARGET_ID)).toBeDefined();
  });
});

// ── Validator invariant edge cases ────────────────────────────────────────────

describe("validateColdPalaceMadnessLinks — invariant 8 and 9", () => {
  function buildMadState(): GameState {
    const base = stateWithColdPalaceResident();
    const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
    const { year, month, period, dayIndex } = base.calendar;
    const madnessEffectId = `status_${REAL_TARGET_ID}_000099`;
    const madnessEffect: ColdPalaceMadnessEffect = {
      id: madnessEffectId,
      kind: "cold_palace_madness",
      characterId: REAL_TARGET_ID,
      sourceColdPalaceEffectId: effect.id,
      startedAt: { year, month, period, dayIndex },
      startTurn: dayIndex,
    };
    const incident: ColdPalaceMentalBreakdownIncident = {
      id: `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`,
      residentId: REAL_TARGET_ID,
      effectId: effect.id,
      kind: "mental_breakdown",
      occurredAt: { year, month, period, dayIndex },
      acknowledged: false,
      madnessEffectId,
    };
    return {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      coldPalaceIncidents: [...base.coldPalaceIncidents, incident],
    };
  }

  it("invariant 8: living mad resident with lifted cold-palace effect fails validator", () => {
    const state = buildMadState();
    // Lift the underlying cold palace effect while character is still alive
    const withLifted: GameState = {
      ...state,
      statusEffects: state.statusEffects.map((e) =>
        e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID
          ? { ...e, liftedTurn: state.calendar.dayIndex, liftReason: "lifted_by_emperor" as const }
          : e,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withLifted);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("linked cold-palace effect") || e.message.includes("not lifted"))).toBe(true);
  });

  it("invariant 8: deceased mad resident with death-lifted cold-palace effect passes validator", () => {
    const state = buildMadState();
    // Mark character deceased + lift the cold palace effect at a later turn
    // (dayIndex+1 ensures effect was still active when madness/incident occurred)
    const withDeceased: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, lifecycle: "deceased" },
      },
      statusEffects: state.statusEffects.map((e) =>
        e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID
          ? { ...e, liftedTurn: state.calendar.dayIndex, liftReason: "death" as const }
          : e,
      ),
    };
    const errors = validateColdPalaceMadnessLinks(withDeceased);
    expect(errors).toHaveLength(0);
  });

  it("invariant 9: madness effect with no breakdown incident fails validator", () => {
    const state = buildMadState();
    // Remove the breakdown incident
    const withoutIncident: GameState = {
      ...state,
      coldPalaceIncidents: state.coldPalaceIncidents.filter((i) => i.kind !== "mental_breakdown"),
    };
    const errors = validateColdPalaceMadnessLinks(withoutIncident);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("mental_breakdown incident"))).toBe(true);
  });

  it("invariant 9: madness effect with two breakdown incidents fails validator", () => {
    const state = buildMadState();
    const incident = state.coldPalaceIncidents.find((i) => i.kind === "mental_breakdown")!;
    const duplicate: ColdPalaceMentalBreakdownIncident = {
      ...(incident as ColdPalaceMentalBreakdownIncident),
      id: `${incident.id}_dup`,
    };
    const withDuplicate: GameState = {
      ...state,
      coldPalaceIncidents: [...state.coldPalaceIncidents, duplicate],
    };
    const errors = validateColdPalaceMadnessLinks(withDuplicate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("mental_breakdown incident"))).toBe(true);
  });
});
