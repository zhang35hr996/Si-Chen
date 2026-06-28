/**
 * Phase 5B-2A: Distribution simulation for InvestigationTruth resolver.
 * Generates 200 truths and verifies statistical properties.
 */
import { describe, expect, it } from "vitest";
import {
  resolveInvestigationTruth,
  buildHeirHealthTruthContext,
} from "../../src/engine/characters/haremInvestigation/truth/truthResolver";
import { validateInvestigationTruths } from "../../src/engine/characters/haremInvestigation/truth/stateValidation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import type { CharacterStanding } from "../../src/engine/state/types";
import type { HeirHealthAnomalyIncident } from "../../src/engine/characters/haremInvestigation/truth/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);
const AT = makeGameTime(1, 1, "early");

const N = 200;
const GAME_SEED = 1;

/**
 * Build a minimal state with 5+ characters having household data so all
 * investigation branches (intentional_harm, framing) have access candidates.
 */
function buildRichState(): GameState {
  const standing: Record<string, CharacterStanding> = {};
  const charIds = ["char_001", "char_002", "char_003", "char_004", "char_005"];
  for (const id of charIds) {
    standing[id] = {
      rank: "meiren",
      favor: 50,
      peakFavor: 50,
      ambition: 70,
      loyalty: 30,
      personality: {
        scheming: 70, sociability: 50, compassion: 40,
        courage: 60, jealousy: 60, emotionalStability: 40,
        pride: 50, intelligence: 55,
      },
      household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 40 },
    };
  }
  return { ...base, standing };
}

function makeIncident(i: number): HeirHealthAnomalyIncident {
  return {
    id: `incident_dist_${i}`,
    eventFamily: "heir_health_anomaly",
    occurredAt: AT,
    sourceKey: `heir_health_anomaly:1:${String(i).padStart(2, "0")}`,
    victimHeirId: "heir_001",
    accuserIds: [],
    initiallyAccusedIds: [],
    symptom: "hysteria",
    publicFactCodes: [],
  };
}

describe("investigationTruth: distribution simulation (N=200)", () => {
  it("DIST-01: natural_illness fraction ≥ 30%", () => {
    const state = buildRichState();
    let naturalCount = 0;
    for (let i = 0; i < N; i++) {
      const ctx = buildHeirHealthTruthContext(makeIncident(i), state, 60);
      const truth = resolveInvestigationTruth(ctx, GAME_SEED);
      if (truth.causeType === "natural_illness") naturalCount++;
    }
    const fraction = naturalCount / N;
    expect(fraction).toBeGreaterThanOrEqual(0.30);
  });

  it("DIST-02: cases where culpritIds is empty (natural + negligence) ≥ 55%", () => {
    const state = buildRichState();
    let emptyCount = 0;
    for (let i = 0; i < N; i++) {
      const ctx = buildHeirHealthTruthContext(
        { ...makeIncident(i), id: `incident_dist2_${i}` },
        state,
        60,
      );
      const truth = resolveInvestigationTruth(ctx, GAME_SEED);
      if (truth.culpritIds.length === 0) emptyCount++;
    }
    const fraction = emptyCount / N;
    expect(fraction).toBeGreaterThanOrEqual(0.55);
  });

  it("DIST-03: no truth has invalid causeType/method combo", () => {
    const state = buildRichState();
    for (let i = 0; i < N; i++) {
      const ctx = buildHeirHealthTruthContext(
        { ...makeIncident(i), id: `incident_dist3_${i}` },
        state,
        60,
      );
      const truth = resolveInvestigationTruth(ctx, GAME_SEED);
      if (truth.method === "none") {
        expect(["natural_illness", "accident"]).toContain(truth.causeType);
      }
      if (truth.causeType === "natural_illness" || truth.causeType === "accident") {
        expect(truth.method).toBe("none");
      }
    }
  });

  it("DIST-04: all 200 truths pass validateInvestigationTruths", () => {
    const state = buildRichState();
    const charIds = Object.keys(state.standing);
    const allCharacterIds = new Set(charIds);

    const incidents = Array.from({ length: N }, (_, i) => ({
      ...makeIncident(i),
      id: `incident_val_${i}`,
    }));
    const truths = incidents.map((incident, i) => {
      const ctx = buildHeirHealthTruthContext(incident, state, 60);
      return resolveInvestigationTruth(ctx, GAME_SEED + i);
    });

    const errors = validateInvestigationTruths({
      investigationTruths: truths,
      investigationIncidents: incidents,
      allCharacterIds,
    });

    if (errors.length > 0) {
      console.error("validation errors:", JSON.stringify(errors.slice(0, 3)));
    }
    expect(errors).toHaveLength(0);
  });
});
