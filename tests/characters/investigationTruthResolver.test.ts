/**
 * Phase 5B-2A: InvestigationTruth resolver unit tests.
 * Tests determinism and invariants of the pure truth-resolution function.
 */
import { describe, expect, it } from "vitest";
import {
  resolveInvestigationTruth,
  buildHeirHealthTruthContext,
} from "../../src/engine/characters/haremInvestigation/truth/truthResolver";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type {
  HeirHealthAnomalyIncident,
  HeirHealthTruthContext,
  TruthCandidateSnapshot,
} from "../../src/engine/characters/haremInvestigation/truth/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);
const AT = makeGameTime(1, 3, "early");
const GAME_SEED = 12345;

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Candidates that have canAccessMedicine=true so all branches are reachable. */
const RICH_CANDIDATES: TruthCandidateSnapshot[] = [
  {
    characterId: "char_001",
    motiveScore: 30, opportunityScore: 20, accessScore: 50,
    ambition: 70, loyalty: 30, scheming: 70, privateWealthLevel: 40,
    canAccessMedicine: true, canInfluenceServants: true,
  },
  {
    characterId: "char_002",
    motiveScore: 20, opportunityScore: 15, accessScore: 50,
    ambition: 60, loyalty: 40, scheming: 60, privateWealthLevel: 25,
    canAccessMedicine: true, canInfluenceServants: true,
  },
  {
    characterId: "char_003",
    motiveScore: 10, opportunityScore: 10, accessScore: 0,
    ambition: 40, loyalty: 60, scheming: 40, privateWealthLevel: 5,
    canAccessMedicine: false, canInfluenceServants: false,
  },
  {
    characterId: "char_004",
    motiveScore: 25, opportunityScore: 12, accessScore: 0,
    ambition: 50, loyalty: 50, scheming: 50, privateWealthLevel: 10,
    canAccessMedicine: false, canInfluenceServants: false,
  },
  {
    characterId: "char_005",
    motiveScore: 35, opportunityScore: 18, accessScore: 50,
    ambition: 75, loyalty: 25, scheming: 75, privateWealthLevel: 50,
    canAccessMedicine: true, canInfluenceServants: true,
  },
];

function makeIncident(
  id: string,
  overrides: Partial<HeirHealthAnomalyIncident> = {},
): HeirHealthAnomalyIncident {
  return {
    id,
    eventFamily: "heir_health_anomaly",
    occurredAt: AT,
    sourceKey: `test_source:${id}`,
    victimHeirId: "heir_001",
    accuserIds: [],
    initiallyAccusedIds: [],
    symptom: "hysteria",
    publicFactCodes: [],
    ...overrides,
  };
}

function makeContext(
  incidentId: string,
  candidateSnapshots: TruthCandidateSnapshot[] = RICH_CANDIDATES,
  incidentOverrides: Partial<HeirHealthAnomalyIncident> = {},
  victimHealth = 60,
): HeirHealthTruthContext {
  return {
    incident: makeIncident(incidentId, incidentOverrides),
    victimHealth,
    candidateSnapshots,
  };
}

// Default context: no public accusers/accused, so only natural/negligence/intentional_harm branches reachable
const CONTEXT = makeContext("incident_test_001");

describe("investigationTruthResolver", () => {
  // ── Determinism ────────────────────────────────────────────────────────────

  it("RT-01: same seed + same context → same causeType", () => {
    const t1 = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    const t2 = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    expect(t1.causeType).toBe(t2.causeType);
  });

  it("RT-02: same seed + same context → same culpritIds", () => {
    const t1 = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    const t2 = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    expect(t1.culpritIds).toEqual(t2.culpritIds);
  });

  it("RT-03: same seed + same context → same evidence IDs", () => {
    const t1 = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    const t2 = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    const ids1 = t1.evidenceNodes.map((n) => n.id);
    const ids2 = t2.evidenceNodes.map((n) => n.id);
    expect(ids1).toEqual(ids2);
  });

  it("RT-04: different incident IDs → different truth IDs", () => {
    const t1 = resolveInvestigationTruth(makeContext("incident_A"), GAME_SEED);
    const t2 = resolveInvestigationTruth(makeContext("incident_B"), GAME_SEED);
    expect(t1.id).not.toBe(t2.id);
  });

  it("RT-05: different game seed → may produce different causeType", () => {
    // At least the truth IDs should stay the same (same incident), but seed affects choice
    const t1 = resolveInvestigationTruth(CONTEXT, 1);
    const t2 = resolveInvestigationTruth(CONTEXT, 99999);
    // Same incidentId → same truth ID
    expect(t1.id).toBe(t2.id);
    // The actual causeType may differ (not guaranteed, but IDs differ in evidence IDs)
    // At minimum verify both are valid
    expect(t1.causeType).toBeTruthy();
    expect(t2.causeType).toBeTruthy();
  });

  // ── Cause-type invariants ──────────────────────────────────────────────────

  it("RT-06: natural_illness branch → culpritIds empty", () => {
    for (let i = 0; i < 20; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_empty_${i}`, []), i);
      if (t.causeType === "natural_illness" || t.causeType === "accident") {
        expect(t.culpritIds).toHaveLength(0);
      }
    }
  });

  it("RT-07: intentional_harm branch → culpritIds non-empty (needs canAccessMedicine candidate)", () => {
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_ih_${i}`), i);
      if (t.causeType === "intentional_harm") {
        expect(t.culpritIds.length).toBeGreaterThan(0);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("RT-08: no valid candidates → forces natural_illness or negligence branch", () => {
    for (let i = 0; i < 50; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_nocandidate_${i}`, []), i);
      expect(["natural_illness", "negligence"]).toContain(t.causeType);
    }
  });

  it("RT-09: no candidates with canAccessMedicine → intentional_harm and framing disabled", () => {
    const noneAccessible: TruthCandidateSnapshot[] = [
      { characterId: "char_A", motiveScore: 50, opportunityScore: 50, accessScore: 0, ambition: 80, loyalty: 20, scheming: 80, privateWealthLevel: 5, canAccessMedicine: false, canInfluenceServants: false },
      { characterId: "char_B", motiveScore: 40, opportunityScore: 40, accessScore: 0, ambition: 70, loyalty: 30, scheming: 70, privateWealthLevel: 8, canAccessMedicine: false, canInfluenceServants: false },
      { characterId: "char_C", motiveScore: 30, opportunityScore: 30, accessScore: 0, ambition: 60, loyalty: 40, scheming: 60, privateWealthLevel: 3, canAccessMedicine: false, canInfluenceServants: false },
    ];
    // Even with initiallyAccusedIds, no medicine access means no framing culprit
    for (let i = 0; i < 50; i++) {
      const t = resolveInvestigationTruth(
        makeContext(`incident_noaccess_${i}`, noneAccessible, { initiallyAccusedIds: ["char_A"] }),
        i,
      );
      expect(t.causeType).not.toBe("intentional_harm");
      expect(t.causeType).not.toBe("framing");
    }
  });

  // ── Framing invariants ─────────────────────────────────────────────────────

  it("RT-10: framing branch → culprit ≠ framingTarget; target from initiallyAccusedIds", () => {
    // char_003 and char_004 have canAccessMedicine=false → they can be framing targets
    // char_001, char_002, char_005 have canAccessMedicine=true → they can be culprits
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      const t = resolveInvestigationTruth(
        makeContext(`incident_fr_${i}`, RICH_CANDIDATES, { initiallyAccusedIds: ["char_003"] }),
        i,
      );
      if (t.causeType === "framing") {
        expect(t.culpritIds.length).toBeGreaterThan(0);
        expect(t.framingTargetIds.length).toBeGreaterThan(0);
        expect(t.culpritIds[0]).not.toBe(t.framingTargetIds[0]);
        // Framing target must come from initiallyAccusedIds
        expect(t.framingTargetIds[0]).toBe("char_003");
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("RT-10b: framing disabled when initiallyAccusedIds is empty", () => {
    for (let i = 0; i < 50; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_fr_noacc_${i}`), i);
      expect(t.causeType).not.toBe("framing");
    }
  });

  // ── False accusation invariants ────────────────────────────────────────────

  it("RT-11: false_accusation → culprit from accuserIds, accused from initiallyAccusedIds", () => {
    // char_001 is the accuser-candidate, char_002 is the wrongly accused
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      const t = resolveInvestigationTruth(
        makeContext(`incident_fa_${i}`, RICH_CANDIDATES, {
          accuserIds: ["char_001"],
          initiallyAccusedIds: ["char_002"],
        }),
        i,
      );
      if (t.causeType === "false_accusation") {
        expect(t.accusedIds.length).toBeGreaterThan(0);
        expect(t.culpritIds.length).toBeGreaterThan(0);
        // Culprit must come from accuserIds
        expect(t.culpritIds[0]).toBe("char_001");
        // Accused must come from initiallyAccusedIds
        expect(t.accusedIds[0]).toBe("char_002");
        expect(t.culpritIds[0]).not.toBe(t.accusedIds[0]);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("RT-12: false_accusation disabled when no accuserIds or no initiallyAccusedIds", () => {
    // No accuserIds → disabled
    for (let i = 0; i < 50; i++) {
      const t = resolveInvestigationTruth(
        makeContext(`incident_fa_noaccuser_${i}`, RICH_CANDIDATES, { initiallyAccusedIds: ["char_002"] }),
        i,
      );
      expect(t.causeType).not.toBe("false_accusation");
    }
    // No initiallyAccusedIds → disabled
    for (let i = 0; i < 50; i++) {
      const t = resolveInvestigationTruth(
        makeContext(`incident_fa_noaccused_${i}`, RICH_CANDIDATES, { accuserIds: ["char_001"] }),
        i,
      );
      expect(t.causeType).not.toBe("false_accusation");
    }
  });

  // ── Evidence invariants ────────────────────────────────────────────────────

  it("RT-13: all evidence IDs unique within a single truth", () => {
    const t = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    const ids = t.evidenceNodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("RT-14: evidence IDs globally unique across 100 generated truths", () => {
    const allIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_uniq_${i}`), i);
      allIds.push(...t.evidenceNodes.map((n) => n.id));
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("RT-15: evidence claims are bound to actual character IDs (not symbolic refs)", () => {
    // Find an intentional_harm truth to check character binding
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_claim_${i}`), i);
      if (t.causeType === "intentional_harm" && t.culpritIds.length > 0) {
        const culpritId = t.culpritIds[0]!;
        // Find a node with implicates_character claim
        const implNode = t.evidenceNodes.find((n) =>
          n.claims.some((c) => c.kind === "implicates_character"),
        );
        if (implNode) {
          const claim = implNode.claims.find((c) => c.kind === "implicates_character")!;
          if (claim.kind === "implicates_character") {
            // characterRef should be an actual ID, not a symbolic name
            expect(["culprit", "framing_target", "accused"]).not.toContain(claim.characterRef);
            expect(claim.characterRef).toBe(culpritId);
          }
        }
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  // ── Method invariants ──────────────────────────────────────────────────────

  it("RT-16: method matches causeType (none only for natural/accident)", () => {
    for (let i = 0; i < 100; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_method_${i}`), i);
      if (t.method === "none") {
        expect(["natural_illness", "accident"]).toContain(t.causeType);
      }
      if (t.causeType === "natural_illness" || t.causeType === "accident") {
        expect(t.method).toBe("none");
      }
    }
  });

  it("RT-17: negligence method is not induced_symptoms", () => {
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_neg_${i}`), i);
      if (t.causeType === "negligence") {
        expect(t.method).not.toBe("induced_symptoms");
        expect(["wrong_dosage", "contaminated_medicine", "treatment_delay", "medicine_mixup"]).toContain(t.method);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  // ── Concealment range ──────────────────────────────────────────────────────

  it("RT-18: concealment always in [40, 80]", () => {
    for (let i = 0; i < 100; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_con_${i}`), i);
      expect(t.concealment).toBeGreaterThanOrEqual(40);
      expect(t.concealment).toBeLessThanOrEqual(80);
    }
  });

  // ── incidentId propagation ─────────────────────────────────────────────────

  it("RT-19: truth.incidentId matches context.incident.id", () => {
    const t = resolveInvestigationTruth(CONTEXT, GAME_SEED);
    expect(t.incidentId).toBe(CONTEXT.incident.id);
    expect(t.id).toBe(`itruth_${CONTEXT.incident.id}`);
  });

  // ── victimHealth weight influence ─────────────────────────────────────────

  it("RT-21: low victimHealth produces higher natural_illness rate than high victimHealth", () => {
    const LOW = 10;
    const HIGH = 90;
    let naturalLow = 0;
    let naturalHigh = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      if (resolveInvestigationTruth(makeContext(`low_${i}`, RICH_CANDIDATES, {}, LOW), i).causeType === "natural_illness") naturalLow++;
      if (resolveInvestigationTruth(makeContext(`high_${i}`, RICH_CANDIDATES, {}, HIGH), i).causeType === "natural_illness") naturalHigh++;
    }
    expect(naturalLow).toBeGreaterThan(naturalHigh);
  });

  // ── Negligence method ↔ evidence consistency ───────────────────────────────

  it("RT-22: negligence evidence reveals the actual truth.method (not always wrong_dosage)", () => {
    const methodsFound = new Set<string>();
    let negligenceCount = 0;
    for (let i = 0; i < 500; i++) {
      const t = resolveInvestigationTruth(makeContext(`incident_neg_m_${i}`), i);
      if (t.causeType === "negligence") {
        negligenceCount++;
        const methodClaim = t.evidenceNodes
          .flatMap((n) => n.claims)
          .find((c) => c.kind === "reveals_method");
        if (methodClaim && methodClaim.kind === "reveals_method") {
          expect(methodClaim.method).toBe(t.method);
          methodsFound.add(methodClaim.method);
        }
      }
    }
    expect(negligenceCount).toBeGreaterThan(0);
    // Multiple negligence methods should appear across 500 runs
    expect(methodsFound.size).toBeGreaterThan(1);
  });

  // ── buildHeirHealthTruthContext ────────────────────────────────────────────

  it("RT-20: buildHeirHealthTruthContext builds correct candidate snapshots", () => {
    const stateWithStanding = {
      ...base,
      standing: {
        cheng_feng: {
          rank: "meiren",
          favor: 50,
          peakFavor: 50,
          ambition: 70,
          loyalty: 30,
          personality: { scheming: 70, sociability: 40, compassion: 20, courage: 60, jealousy: 70, emotionalStability: 30, pride: 40, intelligence: 55 },
          household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 40 },
        },
        lu_huaijin: {
          rank: "guiren",
          favor: 60,
          peakFavor: 70,
          ambition: 40,
          loyalty: 60,
          personality: { scheming: 30, sociability: 60, compassion: 60, courage: 40, jealousy: 30, emotionalStability: 60, pride: 50, intelligence: 50 },
          household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 25 },
        },
      },
    };
    const incident = makeIncident("test_inc_001");
    const ctx = buildHeirHealthTruthContext(incident, stateWithStanding, 70);
    expect(ctx.candidateSnapshots).toHaveLength(2);
    const cheng = ctx.candidateSnapshots.find((s) => s.characterId === "cheng_feng")!;
    expect(cheng).toBeDefined();
    expect(cheng.canAccessMedicine).toBe(true); // privateWealthLevel 40 > 20
  });
});
