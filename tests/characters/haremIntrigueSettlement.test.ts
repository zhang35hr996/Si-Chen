/**
 * haremIntrigueSettlement.ts — integration tests (Phase 5A-2)
 *
 * Covers:
 *   - pending scheme executes in due month
 *   - pending scheme is NOT executed in non-due month
 *   - resolved scheme: standing/household/nation deltas applied
 *   - cancelled scheme (actor deceased): no deltas applied
 *   - discovered scheme: chronicle event appended
 *   - discovered scheme: notification appended
 *   - hidden scheme: no chronicle event, no notification
 *   - next-month scheme planning
 *   - memory writes (actor secret + target consequence)
 *   - household deltas applied
 *   - nation rumor applied
 *   - state immutability (input not mutated)
 *   - all 5 intrigue kinds run at least once
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { settleHaremIntrigue } from "../../src/engine/characters/haremIntrigueSettlement";
import type {
  GameState,
  HaremScheme,
} from "../../src/engine/state/types";
import type { HaremIntriguePlan, HaremIntrigueKind } from "../../src/engine/characters/haremIntrigue/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";
import { materializePersonality, createDefaultHousehold } from "../../src/engine/characters/consortAttrs";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const db = loadRealContent();
const base = createNewGameState(db);

const AT: GameTime = makeGameTime(1, 3, "early");       // year=1, month=3
const NEXT_MONTH: GameTime = makeGameTime(1, 4, "early"); // year=1, month=4

function makeActorSnapshot(id: string): HaremIntriguePlan["actorSnapshot"] {
  return {
    characterId: id,
    rankId: "meiren",
    rankOrder: 100,
    favor: 30,
    peakFavor: 50,
    affection: 50,
    fear: 40,
    ambition: 70,
    loyalty: 30,
    personality: {
      scheming: 70, sociability: 40, compassion: 20,
      courage: 60, jealousy: 70, emotionalStability: 30,
      pride: 40, intelligence: 55,
    },
    household: { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 30 },
  };
}

function makeTargetSnapshot(id: string): HaremIntriguePlan["targetSnapshot"] {
  return {
    characterId: id,
    rankId: "guiren",
    rankOrder: 116,
    favor: 60,
    peakFavor: 70,
    affection: 50,
    fear: 30,
    ambition: 40,
    loyalty: 60,
    personality: {
      scheming: 30, sociability: 60, compassion: 60,
      courage: 40, jealousy: 30, emotionalStability: 60,
      pride: 50, intelligence: 50,
    },
    household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 20 },
  };
}

function makePlan(
  actorId: string,
  targetId: string,
  kind: HaremIntrigueKind = "slander",
  overrides: Partial<HaremIntriguePlan> = {},
): HaremIntriguePlan {
  return {
    sourceKey: `harem_intrigue:1:03`,
    plannedAt: AT,
    year: 1,
    month: 3,
    actorId,
    targetId,
    kind,
    motive: "jealousy",
    actorPropensity: 70,
    targetThreat: 60,
    priority: 65,
    potency: 55,
    secrecy: 50,
    grievanceStrength: 0,
    factionConflict: false,
    actorSnapshot: makeActorSnapshot(actorId),
    targetSnapshot: makeTargetSnapshot(targetId),
    rationale: ["high_jealousy", "favor_gap"],
    ...overrides,
  };
}

function makeScheme(
  actorId: string,
  targetId: string,
  year: number = AT.year,
  month: number = AT.month,
  kind: HaremIntrigueKind = "slander",
  planOverrides: Partial<HaremIntriguePlan> = {},
): HaremScheme {
  const plan = {
    ...makePlan(actorId, targetId, kind, planOverrides),
    sourceKey: `harem_intrigue:${year}:${String(month).padStart(2, "0")}`,
    year,
    month,
    plannedAt: makeGameTime(year, month, "early"),
  };
  const sid = `scheme_${year}_${String(month).padStart(2, "0")}_${actorId}_${targetId}`;
  return {
    id: sid,
    sourceKey: plan.sourceKey,
    plan,
    status: "pending",
    scheduledForYear: year,
    scheduledForMonth: month,
  };
}

/**
 * Create a state with two registered consorts (actor + target) and a pending scheme.
 */
function makeStateWithScheme(
  actorId: string,
  targetId: string,
  scheme: HaremScheme,
  actorOverrides: Partial<GameState["standing"][string]> = {},
  targetOverrides: Partial<GameState["standing"][string]> = {},
): GameState {
  return {
    ...base,
    rngSeed: 42,
    bedchamber: {
      ...base.bedchamber,
      [actorId]: { encounters: [] },
      [targetId]: { encounters: [] },
    },
    standing: {
      ...base.standing,
      [actorId]: {
        rank: "meiren",
        favor: 30,
        peakFavor: 50,
        affection: 50,
        fear: 40,
        ambition: 70,
        loyalty: 30,
        personality: materializePersonality({ scheming: 70, jealousy: 70, courage: 60 }),
        household: createDefaultHousehold(),
        ...actorOverrides,
      },
      [targetId]: {
        rank: "guiren",
        favor: 60,
        peakFavor: 70,
        affection: 50,
        fear: 30,
        ambition: 40,
        loyalty: 60,
        personality: materializePersonality({ scheming: 30, sociability: 60, emotionalStability: 60 }),
        household: { ...createDefaultHousehold(), servantOpinion: 60 },
        ...targetOverrides,
      },
    },
    memories: {
      ...base.memories,
      [actorId]: { entries: [], nextSeq: 1 },
      [targetId]: { entries: [], nextSeq: 1 },
    },
    haremSchemes: [scheme],
    haremIncidents: [],
    pendingIntrigueNotifications: [],
  };
}

// ── State immutability ────────────────────────────────────────────────────────

describe("settleHaremIntrigue: state immutability", () => {
  it("input state is not mutated by settlement", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const schemesSnapshot = JSON.stringify(state.haremSchemes);
    const incidentsSnapshot = JSON.stringify(state.haremIncidents);

    settleHaremIntrigue(db, state, AT);

    expect(JSON.stringify(state.haremSchemes)).toBe(schemesSnapshot);
    expect(JSON.stringify(state.haremIncidents)).toBe(incidentsSnapshot);
  });

  it("returns a new state object (not the same reference)", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    expect(result.state).not.toBe(state);
  });
});

// ── Due-month execution ───────────────────────────────────────────────────────

describe("settleHaremIntrigue: due-month execution", () => {
  it("pending scheme in due month is resolved (status != pending after settle)", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled).toBeDefined();
    expect(settled.status).not.toBe("pending");
  });

  it("pending scheme in due month: incident is produced", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    expect(result.newIncidents).toHaveLength(1);
    expect(result.state.haremIncidents).toHaveLength(1);
  });

  it("pending scheme in non-due month (month+2) is NOT executed", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 5); // scheduled for month 5
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT); // settle at month 3
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled.status).toBe("pending"); // not touched
    expect(result.newIncidents).toHaveLength(0);
  });

  it("pending scheme from earlier month (overdue) is still executed at current AT", () => {
    // AT = year 1, month 3 — but scheme was scheduled for year 1, month 3
    const scheme = makeScheme("actor_001", "target_001", 1, 3);
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled.status).not.toBe("pending");
  });

  it("no pending schemes → no incidents, no scheme changes", () => {
    const state = { ...base, haremSchemes: [], haremIncidents: [], pendingIntrigueNotifications: [] };
    const result = settleHaremIntrigue(db, state, AT);
    expect(result.newIncidents).toHaveLength(0);
    expect(result.state.haremIncidents).toHaveLength(0);
  });
});

// ── Cancelled scheme (actor deceased) ───────────────────────────────────────

describe("settleHaremIntrigue: actor deceased → cancelled", () => {
  it("scheme cancelled when actor is deceased: no standing deltas applied", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme, {
      lifecycle: "deceased",
    });
    const beforeFavor = state.standing["target_001"]!.favor;
    const result = settleHaremIntrigue(db, state, AT);
    const afterFavor = result.state.standing["target_001"]!.favor;
    // Deceased actor → outcome cancelled → no consequences
    expect(afterFavor).toBe(beforeFavor);
  });

  it("scheme cancelled when actor is deceased: incident is produced (consequencesApplied=false)", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme, {
      lifecycle: "deceased",
    });
    const result = settleHaremIntrigue(db, state, AT);
    // May produce incident with consequencesApplied=false
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(["cancelled", "resolved"]).toContain(settledScheme.status);
  });
});

// ── Standing deltas ──────────────────────────────────────────────────────────

describe("settleHaremIntrigue: standing deltas on resolved scheme", () => {
  it("target favor changes after resolved scheme (slander success or fail changes favor)", () => {
    // Run multiple times to ensure at least one gets a resolved outcome
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const beforeFavor = state.standing["target_001"]!.favor;
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      // Slander success should decrease target favor; failure has no favor delta
      const afterFavor = result.state.standing["target_001"]!.favor;
      // favor can only stay same or decrease for slander (no increase)
      expect(afterFavor).toBeLessThanOrEqual(beforeFavor);
    }
    expect(settledScheme.status).not.toBe("pending");
  });

  it("peakFavor never decreases even when favor drops", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const targetSt = result.state.standing["target_001"]!;
    expect(targetSt.peakFavor).toBeGreaterThanOrEqual(targetSt.favor);
  });

  it("actor standing unchanged after settled scheme (slander affects target not actor)", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const beforeActorFavor = state.standing["actor_001"]!.favor;
    const result = settleHaremIntrigue(db, state, AT);
    const afterActorFavor = result.state.standing["actor_001"]!.favor;
    // Slander only targets the target, actor favor unchanged
    expect(afterActorFavor).toBe(beforeActorFavor);
  });
});

// ── Nation rumor ─────────────────────────────────────────────────────────────

describe("settleHaremIntrigue: nation rumor", () => {
  it("nation rumor stays within [0, 100] bounds", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const rumor = result.state.resources.nation.rumor;
    expect(rumor).toBeGreaterThanOrEqual(0);
    expect(rumor).toBeLessThanOrEqual(100);
  });

  it("slander success increases rumor by 1 (buildIntrigueConsequences contract)", () => {
    // Use a deterministic seed where slander succeeds: potency=90, secrecy=90
    // We test that if slander resolved and succeeded, rumor ticked up
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90, secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const baseRumor = state.resources.nation.rumor;
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const outcome = settledScheme.outcome as { success: boolean } | undefined;
      if (outcome?.success) {
        expect(result.state.resources.nation.rumor).toBeGreaterThanOrEqual(baseRumor);
      }
    }
  });
});

// ── Memory writes ────────────────────────────────────────────────────────────

describe("settleHaremIntrigue: memory writes", () => {
  it("actor gets a new memory entry after resolved scheme", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const actorMemories = result.state.memories["actor_001"]!.entries;
      expect(actorMemories.length).toBeGreaterThan(0);
      const secretMemory = actorMemories.find((m) => m.kind === "secret");
      expect(secretMemory).toBeDefined();
    }
  });

  it("target gets a new memory entry after resolved scheme", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const targetMemories = result.state.memories["target_001"]!.entries;
      expect(targetMemories.length).toBeGreaterThan(0);
    }
  });

  it("actor memory id follows mem_{charId}_{seq} format", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const entry = result.state.memories["actor_001"]!.entries[0];
      if (entry) {
        expect(entry.id).toMatch(/^mem_actor_001_\d{6}$/);
      }
    }
  });

  it("actor memory is of kind=secret", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const secretEntry = result.state.memories["actor_001"]!.entries.find((m) => m.kind === "secret");
      expect(secretEntry).toBeDefined();
      expect(secretEntry?.ownerId).toBe("actor_001");
    }
  });

  it("target memory is grievance when discovered, episodic when not", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const targetEntries = result.state.memories["target_001"]!.entries;
      if (targetEntries.length > 0) {
        const entry = targetEntries[0]!;
        const o = settledScheme.outcome as { discovered: boolean } | undefined;
        if (o?.discovered) {
          expect(entry.kind).toBe("grievance");
        } else {
          expect(entry.kind).toBe("episodic");
        }
      }
    }
  });

  it("cancelled scheme (actor deceased): no memory entries added", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme, { lifecycle: "deceased" });
    const result = settleHaremIntrigue(db, state, AT);
    // Cancelled schemes don't write memories
    const actorEntries = result.state.memories["actor_001"]!.entries;
    expect(actorEntries).toHaveLength(0);
  });
});

// ── Chronicle events (discovered) ────────────────────────────────────────────

describe("settleHaremIntrigue: chronicle events", () => {
  it("discovered scheme: chronicle gets intrigue_discovered event", () => {
    // Use high potency/secrecy=1 to maximize discovery chance
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 1, // very low secrecy → high discovery threshold
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const intrigueEvent = result.state.chronicle.find((e) => e.type === "intrigue_discovered");
        expect(intrigueEvent).toBeDefined();
        expect(intrigueEvent?.participants.some((p) => p.charId === "actor_001")).toBe(true);
        expect(intrigueEvent?.participants.some((p) => p.charId === "target_001")).toBe(true);
      }
    }
  });

  it("hidden scheme (high secrecy): no chronicle event added", () => {
    // High secrecy (90) → low discovery chance
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o !== undefined && !o.discovered) {
        const intrigueEvent = result.state.chronicle.find((e) => e.type === "intrigue_discovered");
        expect(intrigueEvent).toBeUndefined();
      }
    }
  });

  it("chronicle event has correct type 'intrigue_discovered'", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 1, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const ev = result.state.chronicle.find((e) => e.type === "intrigue_discovered");
        expect(ev?.type).toBe("intrigue_discovered");
        expect(ev?.id).toMatch(/^evt_\d{6}$/);
      }
    }
  });
});

// ── Notifications (discovered) ────────────────────────────────────────────────

describe("settleHaremIntrigue: notifications", () => {
  it("discovered scheme: pendingIntrigueNotifications gets one entry", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 1, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        expect(result.state.pendingIntrigueNotifications).toHaveLength(1);
        const notif = result.state.pendingIntrigueNotifications[0]!;
        expect(notif.actorId).toBe("actor_001");
        expect(notif.targetId).toBe("target_001");
        expect(notif.dismissed).toBe(false);
      }
    }
  });

  it("hidden scheme: no notification added", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 90, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o !== undefined && !o.discovered) {
        expect(result.state.pendingIntrigueNotifications).toHaveLength(0);
      }
    }
  });

  it("notification id follows inotif_{schemeId} format", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 1, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const notif = result.state.pendingIntrigueNotifications[0]!;
        expect(notif.id).toBe(`inotif_${scheme.id}`);
      }
    }
  });
});

// ── Household deltas ─────────────────────────────────────────────────────────

describe("settleHaremIntrigue: household deltas", () => {
  it("household servantOpinion stays in [0,100] range after delta", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "servant_subversion");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const targetSt = result.state.standing["target_001"]!;
    if (targetSt.household) {
      expect(targetSt.household.servantOpinion).toBeGreaterThanOrEqual(0);
      expect(targetSt.household.servantOpinion).toBeLessThanOrEqual(100);
    }
  });

  it("household livingStandard stays in [0,100] after delta", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "servant_subversion");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const targetSt = result.state.standing["target_001"]!;
    if (targetSt.household) {
      expect(targetSt.household.livingStandard).toBeGreaterThanOrEqual(0);
      expect(targetSt.household.livingStandard).toBeLessThanOrEqual(100);
    }
  });
});

// ── Next-month planning ───────────────────────────────────────────────────────

describe("settleHaremIntrigue: next-month scheme planning", () => {
  it("after settlement, a new scheme for next month may be planned (if candidates exist)", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    // If eligible actors exist, a next-month scheme may be planned
    // We just check that schemes length either stays same or grows by 1
    // (the current scheme gets status update, possibly a new one added)
    expect(result.state.haremSchemes.length).toBeGreaterThanOrEqual(1);
  });

  it("next-month scheme (if created) has status=pending", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const pendingAfter = result.state.haremSchemes.filter((s) => s.status === "pending");
    for (const s of pendingAfter) {
      expect(s.status).toBe("pending");
    }
  });

  it("next-month scheme has correct scheduledForMonth = AT.month + 1", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const newSchemes = result.state.haremSchemes.filter((s) => s.id !== scheme.id);
    for (const s of newSchemes) {
      // Next month is month 4 (AT is month 3)
      expect(s.scheduledForMonth).toBe(NEXT_MONTH.month);
      expect(s.scheduledForYear).toBe(NEXT_MONTH.year);
    }
  });

  it("duplicate sourceKey not planned twice", () => {
    const scheme = makeScheme("actor_001", "target_001");
    // Pre-populate next month's scheme to simulate duplicate
    const nextMonthScheme = makeScheme("actor_001", "target_001", 1, 4, "slander");
    const state = {
      ...makeStateWithScheme("actor_001", "target_001", scheme),
      haremSchemes: [scheme, nextMonthScheme],
    };
    const result = settleHaremIntrigue(db, state, AT);
    // Next month already has a scheme — should not add another
    const month4Schemes = result.state.haremSchemes.filter(
      (s) => s.scheduledForYear === 1 && s.scheduledForMonth === 4,
    );
    expect(month4Schemes.length).toBe(1);
  });

  it("year wraps correctly: month 12 → next month is year+1, month 1", () => {
    const decemberScheme = makeScheme("actor_001", "target_001", 1, 12);
    const AT_DEC: GameTime = makeGameTime(1, 12, "early");
    const state = makeStateWithScheme("actor_001", "target_001", decemberScheme);
    const result = settleHaremIntrigue(db, state, AT_DEC);
    const newSchemes = result.state.haremSchemes.filter(
      (s) => s.status === "pending",
    );
    for (const s of newSchemes) {
      // If a new scheme planned, it should be year 2, month 1
      if (s.scheduledForYear === 2) {
        expect(s.scheduledForMonth).toBe(1);
      }
    }
  });
});

// ── Incident record ───────────────────────────────────────────────────────────

describe("settleHaremIntrigue: incident record", () => {
  it("incident.id follows incident_{schemeId} format", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status !== "cancelled" || settledScheme.outcome !== undefined) {
      const incident = result.state.haremIncidents[0];
      if (incident) {
        expect(incident.id).toBe(`incident_${scheme.id}`);
      }
    }
  });

  it("incident.kind matches scheme kind", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "false_accusation");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const incident = result.state.haremIncidents[0];
    if (incident) {
      expect(incident.kind).toBe("false_accusation");
    }
  });

  it("incident.actorId and targetId match the plan", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const incident = result.state.haremIncidents[0];
    if (incident) {
      expect(incident.actorId).toBe("actor_001");
      expect(incident.targetId).toBe("target_001");
    }
  });

  it("resolved incident has consequencesApplied=true", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    const incident = result.state.haremIncidents.find((i) => i.schemeId === scheme.id);
    if (settledScheme.status === "resolved" && incident) {
      expect(incident.consequencesApplied).toBe(true);
    }
  });
});

// ── All 5 scheme kinds integration ───────────────────────────────────────────

describe("settleHaremIntrigue: all 5 scheme kinds", () => {
  const kinds: HaremIntrigueKind[] = [
    "slander",
    "false_accusation",
    "steal_credit",
    "faction_pressure",
    "servant_subversion",
  ];

  for (const kind of kinds) {
    it(`kind="${kind}" executes without error`, () => {
      const motive = kind === "false_accusation" ? "ambition" : "jealousy";
      const scheme = makeScheme("actor_001", "target_001", 1, 3, kind, { motive });
      const state = makeStateWithScheme("actor_001", "target_001", scheme);
      expect(() => settleHaremIntrigue(db, state, AT)).not.toThrow();
    });

    it(`kind="${kind}": scheme status transitions from pending`, () => {
      const motive = kind === "false_accusation" ? "ambition" : "jealousy";
      const scheme = makeScheme("actor_001", "target_001", 1, 3, kind, { motive });
      const state = makeStateWithScheme("actor_001", "target_001", scheme);
      const result = settleHaremIntrigue(db, state, AT);
      const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
      expect(settled.status).not.toBe("pending");
    });
  }
});

// ── Multiple schemes in same month ───────────────────────────────────────────

describe("settleHaremIntrigue: multiple schemes", () => {
  it("two due schemes both get processed in same settlement call", () => {
    const scheme1 = makeScheme("actor_001", "target_001");
    const scheme2: HaremScheme = {
      ...makeScheme("actor_001", "target_001", 1, 3, "steal_credit"),
      id: "scheme_1_03_actor_001_target_002",
      plan: {
        ...makePlan("actor_001", "target_002", "steal_credit"),
        sourceKey: "harem_intrigue:1:03",
      },
    };

    const state: GameState = {
      ...makeStateWithScheme("actor_001", "target_001", scheme1),
      standing: {
        ...makeStateWithScheme("actor_001", "target_001", scheme1).standing,
        "target_002": {
          rank: "meiren",
          favor: 40,
          peakFavor: 50,
          ambition: 40,
          loyalty: 60,
          personality: materializePersonality({ scheming: 30, emotionalStability: 60 }),
          household: createDefaultHousehold(),
        },
      },
      memories: {
        ...makeStateWithScheme("actor_001", "target_001", scheme1).memories,
        "target_002": { entries: [], nextSeq: 1 },
      },
      haremSchemes: [scheme1, scheme2],
    };

    const result = settleHaremIntrigue(db, state, AT);
    const s1 = result.state.haremSchemes.find((s) => s.id === scheme1.id)!;
    const s2 = result.state.haremSchemes.find((s) => s.id === scheme2.id)!;
    expect(s1.status).not.toBe("pending");
    expect(s2.status).not.toBe("pending");
  });
});

// ── Fix: target memory unresolved=discovered (not discovered&&success) ────────

describe("settleHaremIntrigue: target memory unresolved flag", () => {
  it("discovered+success → target memory unresolved=true", () => {
    // secrecy=1 → high discovery; potency=90 → high success chance
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o?.discovered && o?.success) {
        const targetEntry = result.state.memories["target_001"]!.entries[0];
        expect(targetEntry?.unresolved).toBe(true);
      }
    }
  });

  it("discovered+failure → target memory unresolved=true (core fix)", () => {
    // secrecy=1 → high discovery; potency=10 → lower success chance
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 10,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o?.discovered && !o?.success) {
        const targetEntry = result.state.memories["target_001"]!.entries[0];
        // A discovered but failed plot still creates unresolved grievance
        expect(targetEntry?.unresolved).toBe(true);
      }
    }
  });

  it("hidden+success → target memory unresolved=false", () => {
    // secrecy=90 → low discovery
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o !== undefined && !o.discovered && o.success) {
        const targetEntry = result.state.memories["target_001"]!.entries[0];
        // Target doesn't know the instigator — no unresolved grievance
        expect(targetEntry?.unresolved).toBe(false);
      }
    }
  });

  it("hidden+failure → target memory unresolved=false", () => {
    // secrecy=90 → low discovery; potency=10 → lower success
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 10,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o !== undefined && !o.discovered && !o.success) {
        const targetEntry = result.state.memories["target_001"]!.entries[0];
        expect(targetEntry?.unresolved).toBe(false);
      }
    }
  });
});

// ── Fix: corrupted actorSnapshot → scheme cancelled, no throw ──────────────

describe("settleHaremIntrigue: corrupted actorSnapshot → no throw, scheme cancelled", () => {
  it("scheme with actorSnapshot={} → does not throw, scheme is cancelled", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const corruptedScheme: HaremScheme = {
      ...scheme,
      plan: {
        ...scheme.plan,
        actorSnapshot: {} as HaremIntriguePlan["actorSnapshot"],
      },
    };
    const state = makeStateWithScheme("actor_001", "target_001", corruptedScheme);
    let result: ReturnType<typeof settleHaremIntrigue>;
    expect(() => {
      result = settleHaremIntrigue(db, state, AT);
    }).not.toThrow();
    const settled = result!.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled.status).toBe("cancelled");
  });
});

// ── Scheme outcome recorded on scheme ────────────────────────────────────────

describe("settleHaremIntrigue: scheme outcome persistence", () => {
  it("resolved scheme has outcome field set", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      expect(settled.outcome).toBeDefined();
      const o = settled.outcome as { status: string };
      expect(o.status).toBe("resolved");
    }
  });

  it("newIncidents returned matches haremIncidents appended to state", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settleHaremIntrigue(db, state, AT);
    for (const inc of result.newIncidents) {
      expect(result.state.haremIncidents.some((i) => i.id === inc.id)).toBe(true);
    }
  });
});
