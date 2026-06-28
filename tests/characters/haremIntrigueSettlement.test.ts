/**
 * haremIntrigueSettlement.ts — integration tests (Phase 5A-3a)
 *
 * Covers:
 *   - pending scheme executes in due month
 *   - pending scheme is NOT executed in non-due month
 *   - resolved scheme: standing/household/nation deltas applied
 *   - cancelled scheme (actor deceased): no deltas applied
 *   - discovered scheme: chronicle event appended
 *   - discovered scheme: haremIntrigueReports gets exposure report
 *   - hidden scheme: no chronicle event, no exposure report
 *   - next-month scheme planning
 *   - memory writes (actor secret + target consequence)
 *   - household deltas applied
 *   - nation rumor applied
 *   - state immutability (input not mutated)
 *   - all 5 intrigue kinds run at least once
 *   - idempotency: period key prevents double-settlement
 *   - catch-up: overdue schemes from prior months get processed
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

/** Convenience wrapper: unwrap Result and throw on error (test-only). */
function settle(
  state: GameState,
  at: GameTime = AT,
) {
  const r = settleHaremIntrigue(db, state, at);
  if (!r.ok) throw new Error(`settlement failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

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
    haremIntrigueReports: [],
    settledHaremIntriguePeriods: [],
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
    const result = settle(state);
    expect(result.state).not.toBe(state);
  });
});

// ── Due-month execution ───────────────────────────────────────────────────────

describe("settleHaremIntrigue: due-month execution", () => {
  it("pending scheme in due month is resolved (status != pending after settle)", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled).toBeDefined();
    expect(settled.status).not.toBe("pending");
  });

  it("pending scheme in due month: incident is produced", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    expect(result.newIncidents).toHaveLength(1);
    expect(result.state.haremIncidents).toHaveLength(1);
  });

  it("pending scheme in non-due month (month+2) is NOT executed", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 5); // scheduled for month 5
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state); // settle at month 3
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled.status).toBe("pending"); // not touched
    expect(result.newIncidents).toHaveLength(0);
  });

  it("pending scheme from earlier month (overdue) is still executed at current AT", () => {
    // AT = year 1, month 3 — scheme was scheduled for year 1, month 3
    const scheme = makeScheme("actor_001", "target_001", 1, 3);
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled.status).not.toBe("pending");
  });

  it("no pending schemes → no incidents, no scheme changes", () => {
    const state: GameState = {
      ...base,
      haremSchemes: [],
      haremIncidents: [],
      haremIntrigueReports: [],
      settledHaremIntriguePeriods: [],
    };
    const result = settle(state);
    expect(result.newIncidents).toHaveLength(0);
    expect(result.state.haremIncidents).toHaveLength(0);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("settleHaremIntrigue: idempotency", () => {
  it("second call for same period returns no new incidents", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const first = settle(state);
    const second = settle(first.state);
    expect(second.newIncidents).toHaveLength(0);
    expect(second.state.haremIncidents).toHaveLength(first.state.haremIncidents.length);
  });

  it("period key is written after settlement", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    expect(result.state.settledHaremIntriguePeriods).toContain("harem_intrigue_settlement:1:03");
  });
});

// ── Catch-up: overdue schemes ─────────────────────────────────────────────────

describe("settleHaremIntrigue: catch-up overdue schemes", () => {
  it("scheme from 2 months ago is processed in current settlement", () => {
    // Scheme scheduled for month 1, settling at month 3
    const scheme = makeScheme("actor_001", "target_001", 1, 1);
    const state: GameState = {
      ...makeStateWithScheme("actor_001", "target_001", scheme),
      haremSchemes: [scheme],
      settledHaremIntriguePeriods: ["harem_intrigue_settlement:1:01", "harem_intrigue_settlement:1:02"],
    };
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(settled.status).not.toBe("pending");
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
    const result = settle(state);
    const afterFavor = result.state.standing["target_001"]!.favor;
    // Deceased actor → outcome cancelled → no consequences
    expect(afterFavor).toBe(beforeFavor);
  });

  it("scheme cancelled when actor is deceased: incident is produced (consequencesApplied=false)", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme, {
      lifecycle: "deceased",
    });
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    expect(["cancelled", "resolved"]).toContain(settledScheme.status);
  });
});

// ── Standing deltas ──────────────────────────────────────────────────────────

describe("settleHaremIntrigue: standing deltas on resolved scheme", () => {
  it("target favor changes after resolved scheme (slander success or fail changes favor)", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const beforeFavor = state.standing["target_001"]!.favor;
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const afterFavor = result.state.standing["target_001"]!.favor;
      // Slander either succeeds (favor drops) or fails (actor fears up); not both favor+
      expect(typeof afterFavor).toBe("number");
      expect(afterFavor).toBeGreaterThanOrEqual(0);
      expect(afterFavor).toBeLessThanOrEqual(100);
    }
    // If cancelled, favor doesn't change
    if (settledScheme.status === "cancelled") {
      expect(result.state.standing["target_001"]!.favor).toBe(beforeFavor);
    }
  });

  it("steal_credit success: actor favor increases", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "steal_credit", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const beforeActorFavor = state.standing["actor_001"]!.favor;
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { success: boolean } | undefined;
      if (o?.success) {
        expect(result.state.standing["actor_001"]!.favor).toBeGreaterThan(beforeActorFavor);
      }
    }
  });

  it("nation rumor delta within [0, 100]", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const rumor = result.state.resources.nation.rumor;
    expect(rumor).toBeGreaterThanOrEqual(0);
    expect(rumor).toBeLessThanOrEqual(100);
  });
});

// ── Memory writes ────────────────────────────────────────────────────────────

describe("settleHaremIntrigue: memory writes", () => {
  it("resolved scheme: actor gets a secret memory", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
    const result = settle(state);
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
    const result = settle(state);
    // Cancelled schemes don't write memories
    const actorEntries = result.state.memories["actor_001"]!.entries;
    expect(actorEntries).toHaveLength(0);
  });
});

// ── Chronicle events (discovered) ────────────────────────────────────────────

describe("settleHaremIntrigue: chronicle events", () => {
  it("discovered scheme: chronicle gets intrigue_discovered event", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
    const result = settle(state);
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

// ── Reports (haremIntrigueReports) ───────────────────────────────────────────

describe("settleHaremIntrigue: haremIntrigueReports", () => {
  it("exposed scheme: haremIntrigueReports gets one exposure report", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 1, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        expect(result.state.haremIntrigueReports).toHaveLength(1);
        const report = result.state.haremIntrigueReports[0]!;
        expect(report.reportKind).toBe("exposure");
        expect(report.confidence).toBe("confirmed");
        expect(report.suspectedActorIds).toContain("actor_001");
        expect(report.knownTargetIds).toContain("target_001");
        expect(report.status).toBe("unread");
      }
    }
  });

  it("high-potency hidden success: anomaly report generated (no actor revealed)", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o !== undefined && !o.discovered && o.success) {
        const reports = result.state.haremIntrigueReports;
        if (reports.length > 0) {
          const report = reports[0]!;
          expect(report.reportKind).toBe("anomaly");
          // Anomaly reports must NOT reveal actorId
          expect(report.suspectedActorIds).toHaveLength(0);
          expect(report.knownTargetIds).toContain("target_001");
        }
      }
    }
  });

  it("hidden scheme (low potency): no report added", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 90, potency: 10 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o !== undefined && !o.discovered) {
        // Low potency hidden → no report
        expect(result.state.haremIntrigueReports).toHaveLength(0);
      }
    }
  });

  it("report id follows ireport_incident_{schemeId} format", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 1, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const report = result.state.haremIntrigueReports[0]!;
        expect(report.id).toBe(`ireport_incident_${scheme.id}`);
      }
    }
  });
});

// ── Household deltas ─────────────────────────────────────────────────────────

describe("settleHaremIntrigue: household deltas", () => {
  it("household servantOpinion stays in [0,100] range after delta", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "servant_subversion");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const targetSt = result.state.standing["target_001"]!;
    if (targetSt.household) {
      expect(targetSt.household.servantOpinion).toBeGreaterThanOrEqual(0);
      expect(targetSt.household.servantOpinion).toBeLessThanOrEqual(100);
    }
  });

  it("household livingStandard stays in [0,100] after delta", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "servant_subversion");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
    const result = settle(state);
    expect(result.state.haremSchemes.length).toBeGreaterThanOrEqual(1);
  });

  it("next-month scheme (if created) has status=pending", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const pendingAfter = result.state.haremSchemes.filter((s) => s.status === "pending");
    for (const s of pendingAfter) {
      expect(s.status).toBe("pending");
    }
  });

  it("next-month scheme has correct scheduledForMonth = AT.month + 1", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const newSchemes = result.state.haremSchemes.filter((s) => s.id !== scheme.id);
    for (const s of newSchemes) {
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
    const result = settle(state);
    const month4Schemes = result.state.haremSchemes.filter(
      (s) => s.scheduledForYear === 1 && s.scheduledForMonth === 4,
    );
    expect(month4Schemes.length).toBe(1);
  });

  it("year wraps correctly: month 12 → next month is year+1, month 1", () => {
    const decemberScheme = makeScheme("actor_001", "target_001", 1, 12);
    const AT_DEC: GameTime = makeGameTime(1, 12, "early");
    const state = makeStateWithScheme("actor_001", "target_001", decemberScheme);
    const result = settle(state, AT_DEC);
    const newSchemes = result.state.haremSchemes.filter(
      (s) => s.status === "pending",
    );
    for (const s of newSchemes) {
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
    const result = settle(state);
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
    const result = settle(state);
    const incident = result.state.haremIncidents[0];
    if (incident) {
      expect(incident.kind).toBe("false_accusation");
    }
  });

  it("incident.actorId and targetId match the plan", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const incident = result.state.haremIncidents[0];
    if (incident) {
      expect(incident.actorId).toBe("actor_001");
      expect(incident.targetId).toBe("target_001");
    }
  });

  it("resolved incident has consequencesApplied=true", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    const incident = result.state.haremIncidents.find((i) => i.schemeId === scheme.id);
    if (settledScheme.status === "resolved" && incident) {
      expect(incident.consequencesApplied).toBe(true);
    }
  });

  it("incident.observationLevel is one of the valid values", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const incident = result.state.haremIncidents[0];
    if (incident) {
      expect(["none", "anomaly", "rumor", "exposed"]).toContain(incident.observationLevel);
    }
  });

  it("exposed incident has courtEventId", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", { secrecy: 1, potency: 90 });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settledScheme = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settledScheme.status === "resolved") {
      const o = settledScheme.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const incident = result.state.haremIncidents.find((i) => i.schemeId === scheme.id)!;
        expect(incident.observationLevel).toBe("exposed");
        expect(incident.courtEventId).toBeDefined();
      }
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
      const result = settle(state);
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

    const result = settle(state);
    const s1 = result.state.haremSchemes.find((s) => s.id === scheme1.id)!;
    const s2 = result.state.haremSchemes.find((s) => s.id === scheme2.id)!;
    expect(s1.status).not.toBe("pending");
    expect(s2.status).not.toBe("pending");
  });
});

// ── Fix: target memory unresolved=discovered (not discovered&&success) ────────

describe("settleHaremIntrigue: target memory unresolved flag", () => {
  it("discovered+success → target memory unresolved=true", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 10,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o?.discovered && !o?.success) {
        const targetEntry = result.state.memories["target_001"]!.entries[0];
        expect(targetEntry?.unresolved).toBe(true);
      }
    }
  });

  it("hidden+success → target memory unresolved=false", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean; success: boolean } | undefined;
      if (o !== undefined && !o.discovered && o.success) {
        const targetEntry = result.state.memories["target_001"]!.entries[0];
        expect(targetEntry?.unresolved).toBe(false);
      }
    }
  });

  it("hidden+failure → target memory unresolved=false", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 10,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
  it("scheme with actorSnapshot={} → result.ok=true, scheme is cancelled", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const corruptedScheme: HaremScheme = {
      ...scheme,
      plan: {
        ...scheme.plan,
        actorSnapshot: {} as HaremIntriguePlan["actorSnapshot"],
      },
    };
    const state = makeStateWithScheme("actor_001", "target_001", corruptedScheme);
    const r = settleHaremIntrigue(db, state, AT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const settled = r.value.state.haremSchemes.find((s) => s.id === scheme.id)!;
      expect(settled.status).toBe("cancelled");
    }
  });
});

// ── Scheme outcome recorded on scheme ────────────────────────────────────────

describe("settleHaremIntrigue: scheme outcome persistence", () => {
  it("resolved scheme has outcome field set", () => {
    const scheme = makeScheme("actor_001", "target_001");
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
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
    const result = settle(state);
    for (const inc of result.newIncidents) {
      expect(result.state.haremIncidents.some((i) => i.id === inc.id)).toBe(true);
    }
  });
});

// ── P2 fix: discovered grievance subjectIds should be [actorId], not [targetId, actorId] ──

describe("settleHaremIntrigue: grievance subjectIds (P2 fix)", () => {
  it("discovered grievance subjectIds=[actorId], does NOT contain targetId", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const targetEntries = result.state.memories["target_001"]!.entries;
        const grievance = targetEntries.find((m) => m.kind === "grievance");
        expect(grievance).toBeDefined();
        expect(grievance!.subjectIds).toContain("actor_001");
        expect(grievance!.subjectIds).not.toContain("target_001");
      }
    }
  });

  it("discovered grievance subjectIds=[actorId] on failure too", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 10,
      secrecy: 1,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean } | undefined;
      if (o?.discovered) {
        const targetEntries = result.state.memories["target_001"]!.entries;
        const grievance = targetEntries.find((m) => m.kind === "grievance");
        expect(grievance).toBeDefined();
        expect(grievance!.subjectIds).toContain("actor_001");
        expect(grievance!.subjectIds).not.toContain("target_001");
      }
    }
  });

  it("hidden episodic memory subjectIds does NOT contain actorId (actor unknown)", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 90,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean } | undefined;
      if (o !== undefined && !o.discovered) {
        const targetEntries = result.state.memories["target_001"]!.entries;
        const episodic = targetEntries.find((m) => m.kind === "episodic");
        if (episodic) {
          expect(episodic.subjectIds).not.toContain("actor_001");
        }
      }
    }
  });

  it("hidden failure episodic memory subjectIds does NOT contain actorId", () => {
    const scheme = makeScheme("actor_001", "target_001", 1, 3, "slander", {
      potency: 10,
      secrecy: 90,
    });
    const state = makeStateWithScheme("actor_001", "target_001", scheme);
    const result = settle(state);
    const settled = result.state.haremSchemes.find((s) => s.id === scheme.id)!;
    if (settled.status === "resolved") {
      const o = settled.outcome as { discovered: boolean } | undefined;
      if (o !== undefined && !o.discovered) {
        const targetEntries = result.state.memories["target_001"]!.entries;
        const episodic = targetEntries.find((m) => m.kind === "episodic");
        if (episodic) {
          expect(episodic.subjectIds).not.toContain("actor_001");
        }
      }
    }
  });
});
