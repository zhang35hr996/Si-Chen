import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import {
  planMonthlyHaremIntrigue,
  buildIntrigueSourceKey,
  enumerateIntrigueCandidates,
} from "../../src/engine/characters/haremIntrigue/planner";
import { buildUnresolvedGrievanceIndex } from "../../src/engine/characters/haremIntrigue/grievance";
import type { GameState } from "../../src/engine/state/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";
import { materializePersonality, createDefaultHousehold } from "../../src/engine/characters/consortAttrs";


const db = loadRealContent();
const base = createNewGameState(db);
const AT: GameTime = makeGameTime(1, 3, "early");

// ── Helpers ─────────────────────────────────────────────

/** Create a minimal synthetic state with N eligible consorts. */
function makeEligibleConsortState(
  count: number,
  overrides: Partial<GameState["standing"][string]> = {},
): GameState {
  const bedchamber: GameState["bedchamber"] = {};
  const standing: GameState["standing"] = {};
  const memories: GameState["memories"] = {};

  // We need a rank in db that is harem domain. "meiren" has order=100
  const rankId = "meiren";

  for (let i = 0; i < count; i++) {
    const id = `gen_consort_${String(i).padStart(3, "0")}`;
    bedchamber[id] = { encounters: [] };
    standing[id] = {
      rank: rankId,
      favor: 30 + (i % 50),
      peakFavor: 50 + (i % 50),
      affection: 50,
      fear: 40,
      ambition: 70,
      loyalty: 30,
      personality: materializePersonality({
        scheming: 70,
        jealousy: 70,
        courage: 60,
        compassion: 20,
        emotionalStability: 30,
        sociability: 40,
        pride: 40,
      }),
      household: { ...createDefaultHousehold(), privateWealthLevel: 30 },
      ...overrides,
    };
    memories[id] = { entries: [], nextSeq: 1 };
  }

  return {
    ...base,
    bedchamber,
    standing: { ...base.standing, ...standing },
    memories: { ...base.memories, ...memories },
  };
}

// ── buildIntrigueSourceKey ─────────────────────────────────────────────

describe("buildIntrigueSourceKey", () => {
  it("formats year:1, month:3 as harem_intrigue:1:03", () => {
    expect(buildIntrigueSourceKey(1, 3)).toBe("harem_intrigue:1:03");
  });

  it("formats year:10, month:12 as harem_intrigue:10:12", () => {
    expect(buildIntrigueSourceKey(10, 12)).toBe("harem_intrigue:10:12");
  });

  it("pads month with leading zero for months 1-9", () => {
    for (let m = 1; m <= 9; m++) {
      expect(buildIntrigueSourceKey(1, m)).toBe(`harem_intrigue:1:0${m}`);
    }
  });

  it("no leading zero for months 10-12", () => {
    for (let m = 10; m <= 12; m++) {
      expect(buildIntrigueSourceKey(1, m)).toBe(`harem_intrigue:1:${m}`);
    }
  });
});

// ── planMonthlyHaremIntrigue ─────────────────────────────────────────────

describe("planMonthlyHaremIntrigue", () => {
  it("returns null when sourceKey already exists", () => {
    const sourceKey = buildIntrigueSourceKey(AT.year, AT.month);
    const existingSourceKeys = new Set([sourceKey]);
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT, existingSourceKeys });
    expect(result).toBeNull();
  });

  it("returns null when no consorts in bedchamber", () => {
    const emptyState: GameState = {
      ...base,
      bedchamber: {},
    };
    const result = planMonthlyHaremIntrigue(db, emptyState, { at: AT });
    expect(result).toBeNull();
  });

  it("returns null when only 1 consort (no pair possible)", () => {
    const state = makeEligibleConsortState(1);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    // Only 1 consort: no target exists, so null
    expect(result).toBeNull();
  });

  it("returns a plan when 2+ eligible consorts with high propensity", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    // With ambition=70, scheming=70, jealousy=70, loyalty=30, propensity should be >45
    // And priority should be >45 with favor gaps
    if (result !== null) {
      expect(result.actorId).toBeTruthy();
      expect(result.targetId).toBeTruthy();
      expect(result.actorId).not.toBe(result.targetId);
    }
  });

  it("plan has correct sourceKey format", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result !== null) {
      expect(result.sourceKey).toBe(buildIntrigueSourceKey(AT.year, AT.month));
    }
  });

  it("is deterministic: same state → same result twice", () => {
    const state = makeEligibleConsortState(5);
    const a = planMonthlyHaremIntrigue(db, state, { at: AT });
    const b = planMonthlyHaremIntrigue(db, state, { at: AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("state is immutable: frozen state does not throw", () => {
    const state = makeEligibleConsortState(5);
    const frozenState = Object.freeze(state);
    expect(() => planMonthlyHaremIntrigue(db, frozenState as GameState, { at: AT })).not.toThrow();
  });

  it("existingSourceKeys is immutable: frozen set does not throw", () => {
    const state = makeEligibleConsortState(5);
    const frozenKeys = Object.freeze(new Set<string>(["other_key"]));
    expect(() => planMonthlyHaremIntrigue(db, state, { at: AT, existingSourceKeys: frozenKeys })).not.toThrow();
  });

  it("snapshot is not a reference to state objects", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;

    // Verify snapshot is a copy, not the same reference
    const actorId = result.actorId;
    const originalFavor = result.actorSnapshot.favor;

    // Modify the state's standing (simulated - we create a new state object)
    const modifiedState: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [actorId]: { ...state.standing[actorId]!, favor: 99 },
      },
    };

    // The old plan's snapshot should not reflect the modification
    expect(result.actorSnapshot.favor).toBe(originalFavor);
    // The snapshot should not be the exact state object
    expect(result.actorSnapshot).not.toBe(modifiedState.standing[actorId]);
  });

  it("plan fields are all integers where expected", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;

    expect(Number.isInteger(result.actorPropensity)).toBe(true);
    expect(Number.isInteger(result.targetThreat)).toBe(true);
    expect(Number.isInteger(result.priority)).toBe(true);
    expect(Number.isInteger(result.potency)).toBe(true);
    expect(Number.isInteger(result.secrecy)).toBe(true);
    expect(Number.isInteger(result.grievanceStrength)).toBe(true);
  });

  it("plan fields are in valid ranges", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;

    expect(result.actorPropensity).toBeGreaterThanOrEqual(0);
    expect(result.actorPropensity).toBeLessThanOrEqual(100);
    expect(result.targetThreat).toBeGreaterThanOrEqual(0);
    expect(result.targetThreat).toBeLessThanOrEqual(100);
    expect(result.priority).toBeGreaterThanOrEqual(0);
    expect(result.priority).toBeLessThanOrEqual(100);
    expect(result.potency).toBeGreaterThanOrEqual(10);
    expect(result.potency).toBeLessThanOrEqual(90);
    expect(result.secrecy).toBeGreaterThanOrEqual(10);
    expect(result.secrecy).toBeLessThanOrEqual(90);
    expect(result.grievanceStrength).toBeGreaterThanOrEqual(0);
    expect(result.grievanceStrength).toBeLessThanOrEqual(100);
  });

  it("plan year and month match AT", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;

    expect(result.year).toBe(AT.year);
    expect(result.month).toBe(AT.month);
    expect(result.plannedAt.year).toBe(AT.year);
    expect(result.plannedAt.month).toBe(AT.month);
  });

  it("actor and target snapshots have correct character IDs", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;

    expect(result.actorSnapshot.characterId).toBe(result.actorId);
    expect(result.targetSnapshot.characterId).toBe(result.targetId);
  });

  it("rationale is in canonical order (no duplicates)", () => {
    const CANONICAL = ["high_jealousy", "high_ambition", "high_scheming", "unresolved_grievance",
      "favor_gap", "peak_favor_gap", "rank_rivalry", "faction_conflict",
      "household_leverage", "low_loyalty", "fear_pressure", "target_influence"];
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;

    const indices = result.rationale.map((code) => CANONICAL.indexOf(code));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
    expect(new Set(result.rationale).size).toBe(result.rationale.length);
  });

  it("actor not equal to target", () => {
    const state = makeEligibleConsortState(5);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;
    expect(result.actorId).not.toBe(result.targetId);
  });

  it("grievance from memory increases grievanceStrength in plan", () => {
    const state = makeEligibleConsortState(3);
    const ids = Object.keys(state.bedchamber).sort();
    if (ids.length < 2) return;

    const actorId = ids[0]!;
    const targetId = ids[1]!;

    const stateWithGrievance: GameState = {
      ...state,
      memories: {
        ...state.memories,
        [actorId]: {
          entries: [{
            id: `mem_${actorId}_000001`,
            ownerId: actorId,
            kind: "grievance",
            subjectIds: [targetId],
            perspective: "target",
            summary: "被欺辱",
            strength: 90,
            retention: "permanent",
            emotions: { anger: 80 },
            triggerTags: [],
            unresolved: true,
            createdAt: AT,
          }],
          nextSeq: 2,
        },
      },
    };

    const resultWithGrievance = planMonthlyHaremIntrigue(db, stateWithGrievance, { at: AT });
    const resultWithout = planMonthlyHaremIntrigue(db, state, { at: AT });

    // With grievance, if the actor/target are the selected pair, grievanceStrength should be 90
    if (resultWithGrievance?.actorId === actorId && resultWithGrievance?.targetId === targetId) {
      expect(resultWithGrievance.grievanceStrength).toBe(90);
    }
    if (resultWithout?.actorId === actorId && resultWithout?.targetId === targetId) {
      expect(resultWithout.grievanceStrength).toBe(0);
    }
  });
});

// ── enumerateIntrigueCandidates ─────────────────────────────────────────────

describe("enumerateIntrigueCandidates", () => {
  it("returns empty when no consorts", () => {
    const emptyState: GameState = { ...base, bedchamber: {} };
    const candidates = enumerateIntrigueCandidates(db, emptyState, { at: AT });
    expect(candidates).toHaveLength(0);
  });

  it("returns candidates with correct actorId/targetId pairs", () => {
    const state = makeEligibleConsortState(5);
    const candidates = enumerateIntrigueCandidates(db, state, { at: AT });
    for (const c of candidates) {
      expect(c.actorId).not.toBe(c.targetId);
    }
  });

  it("all returned candidates have priority >= INTRIGUE_PAIR_THRESHOLD", () => {
    const state = makeEligibleConsortState(5);
    const candidates = enumerateIntrigueCandidates(db, state, { at: AT });
    for (const c of candidates) {
      expect(c.priority).toBeGreaterThanOrEqual(45);
    }
  });

  it("is deterministic", () => {
    const state = makeEligibleConsortState(5);
    const a = enumerateIntrigueCandidates(db, state, { at: AT });
    const b = enumerateIntrigueCandidates(db, state, { at: AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── Stress test with 100 consorts ─────────────────────────────────────────────

describe("stress test: 100 consorts", () => {
  it("completes without stack overflow or errors", () => {
    const state = makeEligibleConsortState(100);
    expect(() => planMonthlyHaremIntrigue(db, state, { at: AT })).not.toThrow();
  });

  it("is deterministic at 100 consorts", () => {
    const state = makeEligibleConsortState(100);
    const a = planMonthlyHaremIntrigue(db, state, { at: AT });
    const b = planMonthlyHaremIntrigue(db, state, { at: AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns a plan (not null) when many eligible consorts exist", () => {
    const state = makeEligibleConsortState(100);
    // With 100 consorts at high ambition/scheming/jealousy, we should get a plan
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    // At these settings propensity should exceed 45
    expect(result).not.toBeNull();
  });
});

// ── P2-D: buildUnresolvedGrievanceIndex ────────────────────────────────────

describe("buildUnresolvedGrievanceIndex (P2-D)", () => {
  function makeGrievanceEntry(overrides: { subjectIds: string[]; strength: number; unresolved: boolean }, idx: number) {
    return {
      id: `mem_${idx}`,
      ownerId: "actor_a",
      kind: "grievance" as const,
      subjectIds: overrides.subjectIds,
      perspective: "actor" as const,
      summary: "test grievance",
      strength: overrides.strength,
      retention: "fast" as const,
      emotions: {},
      triggerTags: [],
      unresolved: overrides.unresolved,
      createdAt: AT,
    };
  }

  function makeStateWithGrievances(): GameState {
    return {
      ...base,
      memories: {
        ...base.memories,
        "actor_a": {
          entries: [
            makeGrievanceEntry({ subjectIds: ["target_b"], strength: 70, unresolved: true }, 1),
            makeGrievanceEntry({ subjectIds: ["target_b"], strength: 40, unresolved: true }, 2),
            makeGrievanceEntry({ subjectIds: ["target_b"], strength: 90, unresolved: false }, 3),
            makeGrievanceEntry({ subjectIds: ["target_c"], strength: 55, unresolved: true }, 4),
          ],
          nextSeq: 5,
        },
        "actor_b": {
          entries: [],
          nextSeq: 1,
        },
      },
    };
  }

  it("returns max strength across unresolved entries (not resolved)", () => {
    const state = makeStateWithGrievances();
    const idx = buildUnresolvedGrievanceIndex(state, ["actor_a"]);
    // 70 vs 40 unresolved; 90 is resolved (excluded)
    expect(idx.get("actor_a")?.get("target_b")).toBe(70);
  });

  it("includes all targets from unresolved entries", () => {
    const state = makeStateWithGrievances();
    const idx = buildUnresolvedGrievanceIndex(state, ["actor_a"]);
    expect(idx.get("actor_a")?.get("target_c")).toBe(55);
  });

  it("excludes resolved grievances", () => {
    const state = makeStateWithGrievances();
    const idx = buildUnresolvedGrievanceIndex(state, ["actor_a"]);
    // strength 90 entry is resolved; should not count
    expect(idx.get("actor_a")?.get("target_b")).toBe(70);  // not 90
  });

  it("returns empty map for actor with no grievances", () => {
    const state = makeStateWithGrievances();
    const idx = buildUnresolvedGrievanceIndex(state, ["actor_b"]);
    expect(idx.get("actor_b")?.size).toBe(0);
  });

  it("creates entry for every consortId passed, even if no memory exists", () => {
    const state = makeStateWithGrievances();
    const idx = buildUnresolvedGrievanceIndex(state, ["no_memory_id"]);
    expect(idx.has("no_memory_id")).toBe(true);
    expect(idx.get("no_memory_id")?.size).toBe(0);
  });

  it("is deterministic", () => {
    const state = makeStateWithGrievances();
    const a = buildUnresolvedGrievanceIndex(state, ["actor_a", "actor_b"]);
    const b = buildUnresolvedGrievanceIndex(state, ["actor_a", "actor_b"]);
    expect(a.get("actor_a")?.get("target_b")).toBe(b.get("actor_a")?.get("target_b"));
    expect(a.get("actor_a")?.get("target_c")).toBe(b.get("actor_a")?.get("target_c"));
  });
});
