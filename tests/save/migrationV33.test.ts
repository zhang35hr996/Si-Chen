/**
 * Save format v32 → v33 migration tests.
 *
 * v33 = Phase 5A-3a: 宫斗情报知识层
 *   1. haremIncidents.discovered(bool) → observationLevel("none"|"exposed")
 *   2. pendingIntrigueNotifications → haremIntrigueReports (exposure reports)
 *   3. settledHaremIntriguePeriods added (default [])
 *   4. pendingIntrigueNotifications field removed
 */
import { describe, expect, it } from "vitest";
import {
  SAVE_FORMAT_VERSION,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";
import type { HaremIntriguePlan, HaremIntrigueKind } from "../../src/engine/characters/haremIntrigue/types";
import { buildIntrigueConsequences } from "../../src/engine/characters/haremIntrigue/consequences";

const db = loadRealContent();

// GameTime constants: { year, month, period, dayIndex }
// dayIndex = ((year-1)*12 + (month-1)) * 3 + periodOrdinal  (early=0, mid=1, late=2)
const AT_Y1M3 = { year: 1, month: 3, period: "early" as const, dayIndex: 6 };
const AT_Y1M2 = { year: 1, month: 2, period: "early" as const, dayIndex: 3 };

// Minimal personality snapshot (all 0-100 ints)
const PERSONALITY = {
  scheming: 70, sociability: 40, compassion: 20,
  courage: 60, jealousy: 70, emotionalStability: 30,
  pride: 40, intelligence: 55,
};
const HOUSEHOLD = { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 30 };

/** Build a minimal resolved outcome for a plan (success=false, discovered=false). */
function makeResolvedOutcome(
  plan: HaremIntriguePlan,
  resolvedAt: typeof AT_Y1M3 = AT_Y1M3,
): Record<string, unknown> {
  return {
    status: "resolved",
    resolvedAt,
    successRoll: 80,
    successThreshold: 50,
    success: false,
    discoveryRoll: 80,
    discoveryThreshold: 40,
    discovered: false,
    consequences: buildIntrigueConsequences(plan, false, false),
    knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
  };
}

/** Minimal valid v32 HaremScheme (status=resolved with outcome to satisfy lifecycle invariants). */
function makeMinimalScheme(id: string, actorId: string, targetId: string): Record<string, unknown> {
  const plan: HaremIntriguePlan = {
    sourceKey: "harem_intrigue:1:03",
    plannedAt: AT_Y1M3,
    year: 1,
    month: 3,
    actorId,
    targetId,
    kind: "slander",
    motive: "jealousy",
    actorPropensity: 70,
    targetThreat: 60,
    priority: 65,
    potency: 55,
    secrecy: 50,
    grievanceStrength: 0,
    factionConflict: false,
    actorSnapshot: {
      characterId: actorId,
      rankId: "meiren",
      rankOrder: 100,
      favor: 30,
      peakFavor: 50,
      affection: 50,
      fear: 40,
      ambition: 70,
      loyalty: 30,
      personality: PERSONALITY,
      household: HOUSEHOLD,
    },
    targetSnapshot: {
      characterId: targetId,
      rankId: "guiren",
      rankOrder: 116,
      favor: 60,
      peakFavor: 70,
      affection: 50,
      fear: 30,
      ambition: 40,
      loyalty: 60,
      personality: { ...PERSONALITY, scheming: 30, jealousy: 30, sociability: 60, emotionalStability: 60 },
      household: { ...HOUSEHOLD, servantOpinion: 60 },
    },
    rationale: ["favor_gap"],
  };
  return {
    id,
    sourceKey: "harem_intrigue:1:03",
    scheduledForYear: 1,
    scheduledForMonth: 3,
    status: "resolved",
    plan,
    outcome: makeResolvedOutcome(plan),
  };
}

/** Minimal v32 incident (includes discovered:bool, which migration converts to observationLevel).
 *  Uses success=false to match the minimal resolved outcome (success=false). */
function makeMinimalIncident(
  schemeId: string,
  actorId: string,
  targetId: string,
  discovered: boolean,
  resolvedAt: typeof AT_Y1M3 = AT_Y1M3,
  kind: HaremIntrigueKind = "slander",
): Record<string, unknown> {
  return {
    id: `incident_${schemeId}`,
    schemeId,
    kind,
    actorId,
    targetId,
    success: false,
    discovered,
    resolvedAt,
    consequencesApplied: true,
  };
}

/** Build a v32-format save. v32 uses discovered:bool on incidents, pendingIntrigueNotifications. */
function makeV32Save(opts?: {
  schemes?: Record<string, unknown>[];
  incidents?: Record<string, unknown>[];
  notifications?: Record<string, unknown>[];
}): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;

  // Strip v33 fields
  delete raw["haremIntrigueReports"];
  delete raw["settledHaremIntriguePeriods"];

  // Set v32-style fields
  raw["pendingIntrigueNotifications"] = opts?.notifications ?? [];
  if (opts?.schemes !== undefined) raw["haremSchemes"] = opts.schemes;
  if (opts?.incidents !== undefined) raw["haremIncidents"] = opts.incidents;

  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 32,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── Version check ─────────────────────────────────────────────────────────────

it("V33-01: SAVE_FORMAT_VERSION >= 33 (v33 migration exists)", () => {
  expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(33);
});

// ── v32 → v33: haremIncidents migration ──────────────────────────────────────

describe("save migration v32 → v33: haremIncidents.discovered → observationLevel", () => {
  it("V33-02: discovered=true → observationLevel='none' (no retroactive court event creation)", () => {
    const scheme = makeMinimalScheme("scheme_001", "actor_001", "target_001");
    const incident = makeMinimalIncident("scheme_001", "actor_001", "target_001", true);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV32Save({ schemes: [scheme], incidents: [incident] }));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const inc = loaded.value.state.haremIncidents[0]!;
    // Old saves can't retroactively create courtEventId, so all incidents → "none"
    expect(inc.observationLevel).toBe("none");
    expect((inc as unknown as { discovered?: boolean }).discovered).toBeUndefined();
  });

  it("V33-03: discovered=false → observationLevel='none'", () => {
    const scheme = makeMinimalScheme("scheme_002", "actor_001", "target_001");
    const incident = makeMinimalIncident("scheme_002", "actor_001", "target_001", false);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV32Save({ schemes: [scheme], incidents: [incident] }));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const inc = loaded.value.state.haremIncidents[0]!;
    expect(inc.observationLevel).toBe("none");
  });

  it("V33-04: discovered field is removed from all incidents", () => {
    const scheme_a = makeMinimalScheme("scheme_a", "actor_001", "target_001");
    const scheme_b = {
      ...makeMinimalScheme("scheme_b", "actor_001", "target_001"),
      sourceKey: "harem_intrigue:1:02",
      scheduledForMonth: 2,
      plan: {
        ...(makeMinimalScheme("scheme_b", "actor_001", "target_001").plan as Record<string, unknown>),
        sourceKey: "harem_intrigue:1:02",
        month: 2,
        plannedAt: AT_Y1M2,
        kind: "steal_credit",
        motive: "ambition",
      },
    };
    const inc_a = makeMinimalIncident("scheme_a", "actor_001", "target_001", true);
    const inc_b = makeMinimalIncident("scheme_b", "actor_001", "target_001", false, AT_Y1M2, "steal_credit");
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV32Save({ schemes: [scheme_a, scheme_b], incidents: [inc_a, inc_b] }),
    );
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const incidents = loaded.value.state.haremIncidents;
    expect(incidents).toHaveLength(2);
    for (const inc of incidents) {
      expect(inc.observationLevel).toBe("none");
      expect((inc as unknown as { discovered?: boolean }).discovered).toBeUndefined();
    }
  });
});

// ── v32 → v33: pendingIntrigueNotifications → haremIntrigueReports ───────────

describe("save migration v32 → v33: pendingIntrigueNotifications → haremIntrigueReports", () => {
  it("V33-05: empty pendingIntrigueNotifications → haremIntrigueReports = []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV32Save({ notifications: [] }));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.haremIntrigueReports)).toBe(true);
    expect(loaded.value.state.haremIntrigueReports).toHaveLength(0);
  });

  it("V33-06: notification converts to exposure report with correct fields", () => {
    const scheme = makeMinimalScheme("scheme_001", "actor_001", "target_001");
    const incident = makeMinimalIncident("scheme_001", "actor_001", "target_001", true);
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV32Save({
        schemes: [scheme],
        incidents: [incident],
        notifications: [
          {
            schemeId: "scheme_001",
            actorId: "actor_001",
            targetId: "target_001",
            kind: "slander",
            success: true,
            dismissed: false,
            createdAt: AT_Y1M3,
          },
        ],
      }),
    );
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const reports = loaded.value.state.haremIntrigueReports;
    expect(reports).toHaveLength(1);
    const r = reports[0]!;
    expect(r.reportKind).toBe("exposure");
    expect(r.confidence).toBe("confirmed");
    expect(r.status).toBe("unread");
    expect(r.suspectedActorIds).toContain("actor_001");
    expect(r.knownTargetIds).toContain("target_001");
    expect(r.id).toBe("ireport_incident_scheme_001");
    expect(r.source.incidentId).toBe("incident_scheme_001");
    expect(r.knownOutcome).toBe("harm_observed");
  });

  it("V33-07: dismissed notification → status='archived', acknowledgedAt set", () => {
    const scheme = makeMinimalScheme("scheme_002", "actor_001", "target_001");
    const incident = makeMinimalIncident("scheme_002", "actor_001", "target_001", true);
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV32Save({
        schemes: [scheme],
        incidents: [incident],
        notifications: [
          {
            schemeId: "scheme_002",
            actorId: "actor_001",
            targetId: "target_001",
            kind: "slander",
            success: false,
            dismissed: true,
            createdAt: AT_Y1M3,
          },
        ],
      }),
    );
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const r = loaded.value.state.haremIntrigueReports[0]!;
    expect(r.status).toBe("archived");
    expect(r.acknowledgedAt).toBeDefined();
    expect(r.knownOutcome).toBe("attempt_observed");
  });

  it("V33-08: success=false notification → knownOutcome='attempt_observed'", () => {
    const basePlan = makeMinimalScheme("scheme_003", "actor_001", "target_001").plan as HaremIntriguePlan;
    const plan003 = { ...basePlan, kind: "false_accusation" as const, motive: "resentment" as const };
    const scheme = {
      ...makeMinimalScheme("scheme_003", "actor_001", "target_001"),
      plan: plan003,
      outcome: makeResolvedOutcome(plan003),
    };
    const incident = {
      ...makeMinimalIncident("scheme_003", "actor_001", "target_001", true, AT_Y1M3, "false_accusation"),
    };
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV32Save({
        schemes: [scheme],
        incidents: [incident],
        notifications: [
          {
            schemeId: "scheme_003",
            actorId: "actor_001",
            targetId: "target_001",
            kind: "false_accusation",
            success: false,
            dismissed: false,
            createdAt: AT_Y1M3,
          },
        ],
      }),
    );
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const r = loaded.value.state.haremIntrigueReports[0]!;
    expect(r.knownOutcome).toBe("attempt_observed");
  });

  it("V33-09: pendingIntrigueNotifications field is removed after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV32Save({ notifications: [] }));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(
      (loaded.value.state as unknown as { pendingIntrigueNotifications?: unknown })
        .pendingIntrigueNotifications,
    ).toBeUndefined();
  });
});

// ── v32 → v33: settledHaremIntriguePeriods added ─────────────────────────────

describe("save migration v32 → v33: settledHaremIntriguePeriods", () => {
  it("V33-10: settledHaremIntriguePeriods is initialised to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV32Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.settledHaremIntriguePeriods)).toBe(true);
    expect(loaded.value.state.settledHaremIntriguePeriods).toHaveLength(0);
  });
});

// ── v32 → v33: schema validation ─────────────────────────────────────────────

describe("save migration v32 → v33: schema", () => {
  it("V33-11: migrated v32 state (empty) passes gameStateSchema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV32Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 5)));
    expect(parsed.success).toBe(true);
  });

  it("V33-12: v32 save with notification and incident migrates cleanly", () => {
    const scheme = makeMinimalScheme("scheme_x", "actor_001", "target_001");
    const incident = makeMinimalIncident("scheme_x", "actor_001", "target_001", true, AT_Y1M2);
    // Adjust scheme resolvedAt and incident to match a different month to test multi-month
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV32Save({
        schemes: [scheme],
        incidents: [incident],
        notifications: [
          {
            schemeId: "scheme_x",
            actorId: "actor_001",
            targetId: "target_001",
            kind: "slander",
            success: true,
            dismissed: false,
            createdAt: AT_Y1M3,
          },
        ],
      }),
    );
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 5)));
    expect(parsed.success).toBe(true);
    // Verify both migrations applied (old incidents always → "none", no retroactive court events)
    expect(loaded.value.state.haremIncidents[0]!.observationLevel).toBe("none");
    expect(loaded.value.state.haremIntrigueReports).toHaveLength(1);
    expect(loaded.value.state.settledHaremIntriguePeriods).toHaveLength(0);
  });

  it("V33-13: round-trip: new-game state saves and reloads at v33", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremIntrigueReports).toEqual([]);
    expect(loaded.value.state.settledHaremIntriguePeriods).toEqual([]);
  });
});
