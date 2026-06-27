import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import {
  scoreIntriguePropensity,
  scoreTargetThreat,
  pairTieJitter,
  scoreIntriguePair,
  computeIntriguePotency,
  computeIntrigueSecrecy,
  buildRationale,
  INTRIGUE_PROPENSITY_THRESHOLD,
  INTRIGUE_PAIR_THRESHOLD,
} from "../../src/engine/characters/haremIntrigue/scoring";

// Minimal ladder for property tests
const PROP_LADDER = [
  { rankId: "meiren", order: 100, index: 0 },
  { rankId: "guiren", order: 116, index: 1 },
  { rankId: "huanghou", order: 1000, index: 2 },
];
import {
  planMonthlyHaremIntrigue,
} from "../../src/engine/characters/haremIntrigue/planner";
import type { IntrigueParticipantSnapshot, HaremIntrigueKind } from "../../src/engine/characters/haremIntrigue/types";
import { RATIONALE_CANONICAL_ORDER } from "../../src/engine/characters/haremIntrigue/types";
import type { GameState } from "../../src/engine/state/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";
import { materializePersonality, createDefaultHousehold } from "../../src/engine/characters/consortAttrs";

const db = loadRealContent();
const base = createNewGameState(db);
const AT: GameTime = makeGameTime(2, 6, "mid");

// Test value boundaries for property sweeps
const BOUNDARY_VALUES = [0, 1, 25, 49, 50, 51, 75, 99, 100];

function makeSnap(over: Partial<IntrigueParticipantSnapshot> = {}): IntrigueParticipantSnapshot {
  return {
    characterId: "prop_actor",
    rankId: "meiren",
    rankOrder: 100,
    favor: 30,
    peakFavor: 50,
    affection: 50,
    fear: 30,
    ambition: 50,
    loyalty: 50,
    personality: {
      scheming: 50,
      sociability: 50,
      compassion: 50,
      courage: 50,
      jealousy: 50,
      emotionalStability: 50,
      pride: 50,
      intelligence: 50,
    },
    household: {
      servantOpinion: 50,
      livingStandard: 50,
      privateWealthLevel: 50,
    },
    ...over,
  };
}

// ── scoreIntriguePropensity properties ─────────────────────────────────────────────

describe("scoreIntriguePropensity property: output is finite integer in [0,100]", () => {
  for (const ambition of BOUNDARY_VALUES) {
    for (const jealousy of BOUNDARY_VALUES) {
      it(`ambition=${ambition} jealousy=${jealousy}`, () => {
        const snap = makeSnap({ ambition, personality: { ...makeSnap().personality, jealousy } });
        const result = scoreIntriguePropensity(snap, 0);
        expect(Number.isFinite(result)).toBe(true);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(100);
      });
    }
  }
});

describe("scoreIntriguePropensity property: deterministic", () => {
  for (const v of [0, 50, 100]) {
    it(`same output for v=${v}`, () => {
      const snap = makeSnap({ ambition: v, fear: v });
      const a = scoreIntriguePropensity(snap, v);
      const b = scoreIntriguePropensity(snap, v);
      expect(a).toBe(b);
    });
  }
});

describe("scoreIntriguePropensity property: monotonic in ambition", () => {
  const values = [0, 25, 50, 75, 100];
  it("non-decreasing as ambition increases", () => {
    const scores = values.map((v) => scoreIntriguePropensity(makeSnap({ ambition: v }), 0));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
  });
});

describe("scoreIntriguePropensity property: monotonic in grievance", () => {
  const values = [0, 25, 50, 75, 100];
  it("non-decreasing as grievance increases", () => {
    const scores = values.map((v) => scoreIntriguePropensity(makeSnap(), v));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
  });
});

// ── scoreTargetThreat properties ─────────────────────────────────────────────

describe("scoreTargetThreat property: output is finite integer in [0,100]", () => {
  for (const favor of [0, 50, 100]) {
    it(`favor=${favor}`, () => {
      const actor = makeSnap({ characterId: "actor" });
      const target = makeSnap({ characterId: "target", favor, peakFavor: Math.max(favor, 30) });
      const result = scoreTargetThreat(actor, target, 0, PROP_LADDER);
      expect(Number.isFinite(result.score)).toBe(true);
      expect(Number.isInteger(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  }
});

describe("scoreTargetThreat property: grievance monotonic", () => {
  it("score non-decreasing as grievance increases", () => {
    const actor = makeSnap({ characterId: "actor" });
    const target = makeSnap({ characterId: "target", favor: 50, peakFavor: 60 });
    const scores = [0, 25, 50, 75, 100].map((g) =>
      scoreTargetThreat(actor, target, g, PROP_LADDER).score
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
  });
});

// ── pairTieJitter properties ─────────────────────────────────────────────

describe("pairTieJitter property: always -2..+2", () => {
  const testPairs = [
    ["a", "b"], ["char_001", "char_002"], ["x" + "0".repeat(20), "y"],
  ];
  for (const [a, b] of testPairs) {
    it(`pair (${a}, ${b})`, () => {
      for (let y = 1; y <= 3; y++) {
        for (let m = 1; m <= 12; m++) {
          const j = pairTieJitter(y, m, a!, b!, 12345);
          expect(j).toBeGreaterThanOrEqual(-2);
          expect(j).toBeLessThanOrEqual(2);
          expect(Number.isInteger(j)).toBe(true);
        }
      }
    });
  }
});

// ── scoreIntriguePair properties ─────────────────────────────────────────────

describe("scoreIntriguePair property: output in [0,100]", () => {
  for (const propensity of BOUNDARY_VALUES) {
    for (const threat of BOUNDARY_VALUES) {
      it(`propensity=${propensity} threat=${threat}`, () => {
        for (const jitter of [-2, 0, 2]) {
          const result = scoreIntriguePair(propensity, threat, jitter);
          expect(Number.isFinite(result)).toBe(true);
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(100);
        }
      });
    }
  }
});

// ── computeIntriguePotency properties ─────────────────────────────────────────────

describe("computeIntriguePotency property: output in [10,90]", () => {
  const kinds: HaremIntrigueKind[] = ["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"];
  for (const scheming of [0, 50, 100]) {
    for (const kind of kinds) {
      it(`scheming=${scheming} kind=${kind}`, () => {
        const snap = makeSnap({ personality: { ...makeSnap().personality, scheming } });
        const result = computeIntriguePotency(snap, kind, 0, 50);
        expect(Number.isFinite(result)).toBe(true);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(10);
        expect(result).toBeLessThanOrEqual(90);
      });
    }
  }
});

// ── computeIntrigueSecrecy properties ─────────────────────────────────────────────

describe("computeIntrigueSecrecy property: output in [10,90]", () => {
  const kinds: HaremIntrigueKind[] = ["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"];
  for (const fear of [0, 50, 100]) {
    for (const kind of kinds) {
      it(`fear=${fear} kind=${kind}`, () => {
        const snap = makeSnap({ fear });
        const result = computeIntrigueSecrecy(snap, kind);
        expect(Number.isFinite(result)).toBe(true);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(10);
        expect(result).toBeLessThanOrEqual(90);
      });
    }
  }
});

// ── buildRationale properties ─────────────────────────────────────────────

describe("buildRationale property: always canonical order, no duplicates", () => {
  for (const loyalty of [0, 35, 50, 100]) {
    it(`loyalty=${loyalty}`, () => {
      const actor = makeSnap({ loyalty, ambition: 70, fear: 70,
        personality: { scheming: 65, sociability: 30, compassion: 30, courage: 30, jealousy: 65, emotionalStability: 30, pride: 30, intelligence: 50 },
        household: { servantOpinion: 70, livingStandard: 50, privateWealthLevel: 70 },
      });
      const target = makeSnap({ characterId: "target" });
      const rationale = buildRationale(actor, target, {
        grievanceStrength: 50,
        factionConflict: true,
        favorGap: 20,
        peakFavorGap: 20,
        rankRivalry: 30,
      });
      // No duplicates
      expect(new Set(rationale).size).toBe(rationale.length);
      // Canonical order
      const indices = rationale.map((code) => RATIONALE_CANONICAL_ORDER.indexOf(code));
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
      }
    });
  }
});

// ── planMonthlyHaremIntrigue stress test ─────────────────────────────────────────────

function makeStressState(count: number): GameState {
  const bedchamber: GameState["bedchamber"] = {};
  const standing: GameState["standing"] = {};
  const memories: GameState["memories"] = {};

  for (let i = 0; i < count; i++) {
    const id = `stress_consort_${String(i).padStart(3, "0")}`;
    bedchamber[id] = { encounters: [] };
    standing[id] = {
      rank: "meiren",
      favor: 20 + (i % 60),
      peakFavor: 40 + (i % 60),
      affection: 50,
      fear: 40,
      ambition: 70,
      loyalty: 30,
      personality: materializePersonality({ scheming: 70, jealousy: 70, courage: 60, compassion: 20, emotionalStability: 30 }),
      household: { ...createDefaultHousehold(), privateWealthLevel: 30 },
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

describe("planMonthlyHaremIntrigue stress: 100 consorts", () => {
  it("completes without error (no stack overflow)", () => {
    const state = makeStressState(100);
    expect(() => planMonthlyHaremIntrigue(db, state, { at: AT })).not.toThrow();
  });

  it("is deterministic at 100 consorts", () => {
    const state = makeStressState(100);
    const a = planMonthlyHaremIntrigue(db, state, { at: AT });
    const b = planMonthlyHaremIntrigue(db, state, { at: AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("plan fields are in valid ranges at 100 consorts", () => {
    const state = makeStressState(100);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;
    expect(result.actorPropensity).toBeGreaterThanOrEqual(0);
    expect(result.actorPropensity).toBeLessThanOrEqual(100);
    expect(result.potency).toBeGreaterThanOrEqual(10);
    expect(result.potency).toBeLessThanOrEqual(90);
    expect(result.secrecy).toBeGreaterThanOrEqual(10);
    expect(result.secrecy).toBeLessThanOrEqual(90);
    expect(result.actorId).not.toBe(result.targetId);
  });

  it("no propensity below threshold returned as actor (propensity filter)", () => {
    const state = makeStressState(100);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;
    expect(result.actorPropensity).toBeGreaterThanOrEqual(INTRIGUE_PROPENSITY_THRESHOLD);
  });

  it("priority meets pair threshold", () => {
    const state = makeStressState(100);
    const result = planMonthlyHaremIntrigue(db, state, { at: AT });
    if (result === null) return;
    expect(result.priority).toBeGreaterThanOrEqual(INTRIGUE_PAIR_THRESHOLD);
  });
});

describe("scoreIntriguePropensity property: no NaN for all boundary combinations", () => {
  it("never produces NaN across boundary inputs", () => {
    for (const ambition of BOUNDARY_VALUES) {
      for (const scheming of BOUNDARY_VALUES) {
        for (const jealousy of BOUNDARY_VALUES) {
          const snap = makeSnap({
            ambition,
            personality: { ...makeSnap().personality, scheming, jealousy },
          });
          const result = scoreIntriguePropensity(snap, 0);
          expect(result).not.toBeNaN();
        }
      }
    }
  });
});
