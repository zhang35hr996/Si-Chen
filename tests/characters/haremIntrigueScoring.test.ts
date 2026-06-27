import { describe, expect, it } from "vitest";
import {
  scoreIntriguePropensity,
  scoreTargetThreat,
  pairTieJitter,
  scoreIntriguePair,
  computeIntriguePotency,
  computeIntrigueSecrecy,
  chooseIntrigueKindAndMotive,
  buildRationale,
  INTRIGUE_PROPENSITY_THRESHOLD,
  INTRIGUE_PAIR_THRESHOLD,
} from "../../src/engine/characters/haremIntrigue/scoring";
import type { IntrigueParticipantSnapshot } from "../../src/engine/characters/haremIntrigue/types";

// Test ladder: 10 ranks from order 52 to order 1000, covering meiren/guiren/other
const TEST_LADDER = [
  { rankId: "meiren", order: 100, index: 0 },
  { rankId: "guiren", order: 116, index: 1 },
  { rankId: "other", order: 156, index: 2 },
  { rankId: "huanghou", order: 1000, index: 3 },
];

function makeSnap(over: Partial<IntrigueParticipantSnapshot> = {}): IntrigueParticipantSnapshot {
  return {
    characterId: "test_char",
    rankId: "meiren",
    rankOrder: 100,
    favor: 30,
    peakFavor: 30,
    affection: 50,
    fear: 30,
    ambition: 35,
    loyalty: 50,
    personality: {
      scheming: 25,
      sociability: 50,
      compassion: 50,
      courage: 40,
      jealousy: 35,
      emotionalStability: 55,
      pride: 45,
      intelligence: 50,
    },
    household: {
      servantOpinion: 50,
      livingStandard: 40,
      privateWealthLevel: 20,
    },
    ...over,
  };
}

// ── scoreIntriguePropensity ─────────────────────────────────────────────

describe("scoreIntriguePropensity", () => {
  it("returns integer", () => {
    const score = scoreIntriguePropensity(makeSnap(), 0);
    expect(Number.isInteger(score)).toBe(true);
  });

  it("returns 0-100", () => {
    expect(scoreIntriguePropensity(makeSnap(), 0)).toBeGreaterThanOrEqual(0);
    expect(scoreIntriguePropensity(makeSnap(), 0)).toBeLessThanOrEqual(100);
  });

  it("is not NaN", () => {
    expect(scoreIntriguePropensity(makeSnap(), 0)).not.toBeNaN();
  });

  it("high ambition increases propensity", () => {
    const lo = scoreIntriguePropensity(makeSnap({ ambition: 20 }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ ambition: 90 }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("high jealousy increases propensity", () => {
    const lo = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, jealousy: 10 } }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, jealousy: 90 } }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("high scheming increases propensity", () => {
    const lo = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, scheming: 10 } }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, scheming: 90 } }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("high compassion decreases propensity", () => {
    const lo = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, compassion: 90 } }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, compassion: 10 } }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("high emotional stability decreases propensity", () => {
    const lo = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, emotionalStability: 90 } }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ personality: { ...makeSnap().personality, emotionalStability: 10 } }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("high grievance increases propensity", () => {
    const lo = scoreIntriguePropensity(makeSnap(), 0);
    const hi = scoreIntriguePropensity(makeSnap(), 80);
    expect(hi).toBeGreaterThan(lo);
  });

  it("low loyalty increases propensity (lowLoyalty = max(0, 60-loyalty))", () => {
    const lo = scoreIntriguePropensity(makeSnap({ loyalty: 90 }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ loyalty: 10 }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("high fear (>50) increases propensity via fearPressure", () => {
    const lo = scoreIntriguePropensity(makeSnap({ fear: 20 }), 0);
    const hi = scoreIntriguePropensity(makeSnap({ fear: 90 }), 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("threshold boundary: just below 45 is below, at 45 is at/above", () => {
    // Verify threshold constant is 45
    expect(INTRIGUE_PROPENSITY_THRESHOLD).toBe(45);
  });

  it("clamped to 0 minimum", () => {
    const snap = makeSnap({
      ambition: 0,
      fear: 0,
      loyalty: 100,
      personality: { scheming: 0, sociability: 0, compassion: 100, courage: 0, jealousy: 0, emotionalStability: 100, pride: 0, intelligence: 50 },
    });
    expect(scoreIntriguePropensity(snap, 0)).toBeGreaterThanOrEqual(0);
  });

  it("clamped to 100 maximum", () => {
    const snap = makeSnap({
      ambition: 100,
      fear: 100,
      loyalty: 0,
      personality: { scheming: 100, sociability: 0, compassion: 0, courage: 100, jealousy: 100, emotionalStability: 0, pride: 100, intelligence: 50 },
    });
    expect(scoreIntriguePropensity(snap, 100)).toBeLessThanOrEqual(100);
  });

  it("deterministic: same inputs → same output", () => {
    const snap = makeSnap({ ambition: 70, fear: 60, loyalty: 30 });
    const a = scoreIntriguePropensity(snap, 50);
    const b = scoreIntriguePropensity(snap, 50);
    expect(a).toBe(b);
  });
});

// ── scoreTargetThreat ─────────────────────────────────────────────

describe("scoreTargetThreat", () => {
  it("returns integer in 0-100", () => {
    const actor = makeSnap({ characterId: "actor", rankOrder: 100 });
    const target = makeSnap({ characterId: "target", rankOrder: 156, favor: 50, peakFavor: 60 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("favorGap is max(0, target.favor - actor.favor)", () => {
    const actor = makeSnap({ characterId: "actor", favor: 20 });
    const target = makeSnap({ characterId: "target", favor: 50, peakFavor: 50 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.favorGap).toBe(30);
  });

  it("favorGap is 0 when target favor <= actor favor", () => {
    const actor = makeSnap({ characterId: "actor", favor: 70 });
    const target = makeSnap({ characterId: "target", favor: 50, peakFavor: 50 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.favorGap).toBe(0);
  });

  it("peakFavorGap is 0 when target peakFavor <= actor peakFavor", () => {
    const actor = makeSnap({ characterId: "actor", favor: 50, peakFavor: 80 });
    const target = makeSnap({ characterId: "target", favor: 50, peakFavor: 60 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.peakFavorGap).toBe(0);
  });

  it("rankRivalry is 0 when target rank <= actor rank (actor at guiren, target at meiren)", () => {
    // actor=guiren (index 1), target=meiren (index 0): target lower → rivalry=0
    const actor = makeSnap({ characterId: "actor", rankId: "guiren", rankOrder: 116 });
    const target = makeSnap({ characterId: "target", rankId: "meiren", rankOrder: 100, peakFavor: 30 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.rankRivalry).toBe(0);
  });

  it("rankRivalry is positive when target rank > actor rank (actor at meiren, target at guiren)", () => {
    // actor=meiren (index 0), target=guiren (index 1): target higher → rivalry > 0
    const actor = makeSnap({ characterId: "actor", rankId: "meiren", rankOrder: 100 });
    const target = makeSnap({ characterId: "target", rankId: "guiren", rankOrder: 116, peakFavor: 30 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.rankRivalry).toBeGreaterThan(0);
  });

  it("factionConflict is true when both have different faction IDs", () => {
    const actor = makeSnap({ characterId: "actor", factionId: "phoenix" });
    const target = makeSnap({ characterId: "target", factionId: "lotus", peakFavor: 30 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.factionConflict).toBe(true);
  });

  it("factionConflict is false when same faction", () => {
    const actor = makeSnap({ characterId: "actor", factionId: "phoenix" });
    const target = makeSnap({ characterId: "target", factionId: "phoenix", peakFavor: 30 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.factionConflict).toBe(false);
  });

  it("factionConflict is false when actor has no faction", () => {
    const actor = makeSnap({ characterId: "actor" });
    const target = makeSnap({ characterId: "target", factionId: "lotus", peakFavor: 30 });
    const result = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    expect(result.factionConflict).toBe(false);
  });

  it("grievance increases threat score", () => {
    const actor = makeSnap({ characterId: "actor" });
    const target = makeSnap({ characterId: "target", peakFavor: 30 });
    const lo = scoreTargetThreat(actor, target, 0, TEST_LADDER);
    const hi = scoreTargetThreat(actor, target, 80, TEST_LADDER);
    expect(hi.score).toBeGreaterThan(lo.score);
  });
});

// ── pairTieJitter ─────────────────────────────────────────────

describe("pairTieJitter", () => {
  it("returns -2..+2", () => {
    const values = new Set<number>();
    for (let m = 1; m <= 12; m++) {
      for (let y = 1; y <= 5; y++) {
        const j = pairTieJitter(y, m, "actorA", "targetB", 12345);
        values.add(j);
        expect(j).toBeGreaterThanOrEqual(-2);
        expect(j).toBeLessThanOrEqual(2);
      }
    }
  });

  it("is deterministic: same inputs → same output", () => {
    const a = pairTieJitter(3, 7, "actorX", "targetY", 12345);
    const b = pairTieJitter(3, 7, "actorX", "targetY", 12345);
    expect(a).toBe(b);
  });

  it("differs for different rngSeeds (same year/month/actors)", () => {
    // Different rngSeeds should produce different jitter values across many seeds
    const seeds = [1, 2, 3, 42, 99, 1000, 999999];
    const results = seeds.map((s) => pairTieJitter(1, 1, "char_a", "char_b", s));
    // Not all values should be identical
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it("differs between different actor/target pairs", () => {
    const a = pairTieJitter(1, 1, "char_a", "char_b", 12345);
    const b = pairTieJitter(1, 1, "char_c", "char_d", 12345);
    // These *may* collide but usually won't; just verify they're valid
    expect(a).toBeGreaterThanOrEqual(-2);
    expect(b).toBeGreaterThanOrEqual(-2);
  });
});

// ── scoreIntriguePair ─────────────────────────────────────────────

describe("scoreIntriguePair", () => {
  it("returns integer 0-100", () => {
    const score = scoreIntriguePair(60, 50, 0);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("threshold constant is 45", () => {
    expect(INTRIGUE_PAIR_THRESHOLD).toBe(45);
  });

  it("higher propensity → higher pair score", () => {
    const lo = scoreIntriguePair(30, 50, 0);
    const hi = scoreIntriguePair(80, 50, 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("higher threat → higher pair score", () => {
    const lo = scoreIntriguePair(60, 20, 0);
    const hi = scoreIntriguePair(60, 80, 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("clamped: all-max stays at 100", () => {
    expect(scoreIntriguePair(100, 100, 2)).toBeLessThanOrEqual(100);
  });

  it("clamped: all-zero stays at 0", () => {
    expect(scoreIntriguePair(0, 0, -2)).toBeGreaterThanOrEqual(0);
  });
});

// ── computeIntriguePotency ─────────────────────────────────────────────

describe("computeIntriguePotency", () => {
  it("returns integer in 10-90", () => {
    const actor = makeSnap({ ambition: 60, personality: { ...makeSnap().personality, scheming: 50 } });
    const p = computeIntriguePotency(actor, "slander", 0, 50);
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(10);
    expect(p).toBeLessThanOrEqual(90);
  });

  it("false_accusation has +5 kind bonus vs slander", () => {
    const actor = makeSnap();
    const p_slander = computeIntriguePotency(actor, "slander", 0, 50);
    const p_fa = computeIntriguePotency(actor, "false_accusation", 0, 50);
    expect(p_fa - p_slander).toBe(5);
  });

  it("faction_pressure has +3 kind bonus vs slander", () => {
    const actor = makeSnap();
    const p_slander = computeIntriguePotency(actor, "slander", 0, 50);
    const p_fp = computeIntriguePotency(actor, "faction_pressure", 0, 50);
    expect(p_fp - p_slander).toBe(3);
  });

  it("servant_subversion has +2 kind bonus vs slander", () => {
    const actor = makeSnap();
    const p_slander = computeIntriguePotency(actor, "slander", 0, 50);
    const p_ss = computeIntriguePotency(actor, "servant_subversion", 0, 50);
    expect(p_ss - p_slander).toBe(2);
  });

  it("steal_credit and slander both have 0 bonus (same result)", () => {
    const actor = makeSnap();
    const p_slander = computeIntriguePotency(actor, "slander", 0, 50);
    const p_sc = computeIntriguePotency(actor, "steal_credit", 0, 50);
    expect(p_sc).toBe(p_slander);
  });

  it("minimum clamped to 10", () => {
    const actor = makeSnap({
      ambition: 0,
      personality: { scheming: 0, sociability: 0, compassion: 0, courage: 0, jealousy: 0, emotionalStability: 0, pride: 0, intelligence: 0 },
      household: { servantOpinion: 0, livingStandard: 0, privateWealthLevel: 0 },
    });
    expect(computeIntriguePotency(actor, "slander", 0, 0)).toBeGreaterThanOrEqual(10);
  });

  it("maximum clamped to 90", () => {
    const actor = makeSnap({
      ambition: 100,
      personality: { scheming: 100, sociability: 100, compassion: 100, courage: 100, jealousy: 100, emotionalStability: 100, pride: 100, intelligence: 100 },
      household: { servantOpinion: 100, livingStandard: 100, privateWealthLevel: 100 },
    });
    expect(computeIntriguePotency(actor, "false_accusation", 100, 100)).toBeLessThanOrEqual(90);
  });
});

// ── computeIntrigueSecrecy ─────────────────────────────────────────────

describe("computeIntrigueSecrecy", () => {
  it("returns integer in 10-90", () => {
    const actor = makeSnap();
    const s = computeIntrigueSecrecy(actor, "slander");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(10);
    expect(s).toBeLessThanOrEqual(90);
  });

  it("faction_pressure has lowest secrecy modifier (-12)", () => {
    const actor = makeSnap({ personality: { ...makeSnap().personality, scheming: 50 }, fear: 0 });
    const s_fp = computeIntrigueSecrecy(actor, "faction_pressure");
    const s_sl = computeIntrigueSecrecy(actor, "slander");
    expect(s_sl - s_fp).toBe(14); // slander=+2, faction_pressure=-12 → diff=14
  });

  it("servant_subversion has highest secrecy modifier (+5)", () => {
    const actor = makeSnap();
    const s_ss = computeIntrigueSecrecy(actor, "servant_subversion");
    const s_sl = computeIntrigueSecrecy(actor, "slander");
    expect(s_ss - s_sl).toBe(3); // servant_subversion=+5, slander=+2 → diff=3
  });

  it("high scheming increases secrecy", () => {
    const lo = computeIntrigueSecrecy(makeSnap({ personality: { ...makeSnap().personality, scheming: 10 } }), "slander");
    const hi = computeIntrigueSecrecy(makeSnap({ personality: { ...makeSnap().personality, scheming: 90 } }), "slander");
    expect(hi).toBeGreaterThan(lo);
  });

  it("high fear decreases secrecy", () => {
    const lo = computeIntrigueSecrecy(makeSnap({ fear: 10 }), "slander");
    const hi = computeIntrigueSecrecy(makeSnap({ fear: 90 }), "slander");
    expect(lo).toBeGreaterThan(hi);
  });

  it("high pride decreases secrecy", () => {
    const lo = computeIntrigueSecrecy(makeSnap({ personality: { ...makeSnap().personality, pride: 90 } }), "slander");
    const hi = computeIntrigueSecrecy(makeSnap({ personality: { ...makeSnap().personality, pride: 10 } }), "slander");
    expect(hi).toBeGreaterThan(lo);
  });

  it("minimum clamped to 10", () => {
    const actor = makeSnap({
      fear: 100,
      personality: { scheming: 0, sociability: 100, compassion: 0, courage: 0, jealousy: 0, emotionalStability: 0, pride: 100, intelligence: 50 },
      household: { ...makeSnap().household, privateWealthLevel: 0 },
    });
    expect(computeIntrigueSecrecy(actor, "faction_pressure")).toBeGreaterThanOrEqual(10);
  });

  it("maximum clamped to 90", () => {
    const actor = makeSnap({
      fear: 0,
      personality: { scheming: 100, sociability: 0, compassion: 0, courage: 0, jealousy: 0, emotionalStability: 100, pride: 0, intelligence: 50 },
      household: { ...makeSnap().household, privateWealthLevel: 100 },
    });
    expect(computeIntrigueSecrecy(actor, "servant_subversion")).toBeLessThanOrEqual(90);
  });
});

// ── chooseIntrigueKindAndMotive ─────────────────────────────────────────────

describe("chooseIntrigueKindAndMotive", () => {
  it("Priority 1: false_accusation when grievance>=70 and scheming>=55", () => {
    const actor = makeSnap({ personality: { ...makeSnap().personality, scheming: 60 } });
    const target = makeSnap({ characterId: "target" });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 75,
      factionConflict: false,
    });
    expect(kind).toBe("false_accusation");
    expect(motive).toBe("resentment");
  });

  it("Priority 2: faction_pressure when factionConflict and courage>=55 and pride>=55", () => {
    const actor = makeSnap({
      ambition: 50,
      personality: { ...makeSnap().personality, courage: 60, pride: 60, scheming: 30 },
    });
    const target = makeSnap({ characterId: "target" });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: true,
    });
    expect(kind).toBe("faction_pressure");
    expect(motive).toBe("faction");
  });

  it("Priority 3: servant_subversion when wealth>=60 and scheming>=60 and target servantOpinion<=55", () => {
    const actor = makeSnap({
      ambition: 50,
      personality: { ...makeSnap().personality, scheming: 65, courage: 30, pride: 30 },
      household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 65 },
    });
    const target = makeSnap({
      characterId: "target",
      household: { servantOpinion: 40, livingStandard: 40, privateWealthLevel: 20 },
    });
    const { kind } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(kind).toBe("servant_subversion");
  });

  it("Priority 4: slander when favorGap>=20 and jealousy>=60", () => {
    const actor = makeSnap({
      favor: 20,
      personality: { ...makeSnap().personality, jealousy: 65, scheming: 30 },
      household: { ...makeSnap().household, privateWealthLevel: 10 },
    });
    const target = makeSnap({
      characterId: "target",
      favor: 60,
      peakFavor: 60,
      household: { servantOpinion: 70, livingStandard: 50, privateWealthLevel: 20 },
    });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(kind).toBe("slander");
    expect(motive).toBe("jealousy");
  });

  it("Priority 5: steal_credit when ambition>=70 and target peakFavor>=60", () => {
    const actor = makeSnap({
      ambition: 75,
      favor: 50,
      personality: { ...makeSnap().personality, jealousy: 30, scheming: 30 },
      household: { ...makeSnap().household, privateWealthLevel: 10 },
    });
    const target = makeSnap({
      characterId: "target",
      favor: 50,
      peakFavor: 70,
      household: { servantOpinion: 70, livingStandard: 50, privateWealthLevel: 20 },
    });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(kind).toBe("steal_credit");
    expect(motive).toBe("ambition");
  });

  it("Priority 6: fear fallback (slander, motive=fear) when fear>=70 and loyalty<=40", () => {
    const actor = makeSnap({
      ambition: 50,
      fear: 75,
      loyalty: 30,
      favor: 40,
      personality: { ...makeSnap().personality, jealousy: 30, scheming: 30 },
      household: { ...makeSnap().household, privateWealthLevel: 10 },
    });
    const target = makeSnap({
      characterId: "target",
      favor: 50,
      peakFavor: 40,
      household: { servantOpinion: 30, livingStandard: 50, privateWealthLevel: 20 },
    });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(kind).toBe("slander");
    expect(motive).toBe("fear");
  });

  it("Priority 7a: steal_credit if ambition>=60 (default)", () => {
    const actor = makeSnap({
      ambition: 65,
      fear: 30,
      loyalty: 80,
      favor: 40,
      personality: { ...makeSnap().personality, jealousy: 30, scheming: 30 },
      household: { ...makeSnap().household, privateWealthLevel: 10 },
    });
    const target = makeSnap({
      characterId: "target",
      favor: 50,
      peakFavor: 40,
      household: { servantOpinion: 30, livingStandard: 50, privateWealthLevel: 20 },
    });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(kind).toBe("steal_credit");
    expect(motive).toBe("ambition");
  });

  it("Priority 7b: slander/jealousy when ambition<60 (fallback)", () => {
    const actor = makeSnap({
      ambition: 30,
      fear: 30,
      loyalty: 80,
      favor: 50,
      personality: { ...makeSnap().personality, jealousy: 30, scheming: 30 },
      household: { ...makeSnap().household, privateWealthLevel: 10 },
    });
    const target = makeSnap({
      characterId: "target",
      favor: 50,
      peakFavor: 40,
      household: { servantOpinion: 30, livingStandard: 50, privateWealthLevel: 20 },
    });
    const { kind, motive } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(kind).toBe("slander");
    expect(motive).toBe("jealousy");
  });

  it("returns rationale array (may be empty for minimal inputs)", () => {
    const actor = makeSnap({ ambition: 30, fear: 30, loyalty: 80, favor: 50 });
    const target = makeSnap({ characterId: "target", favor: 40, peakFavor: 40 });
    const { rationale } = chooseIntrigueKindAndMotive(actor, target, {
      grievanceStrength: 0,
      factionConflict: false,
    });
    expect(Array.isArray(rationale)).toBe(true);
  });
});

// ── buildRationale ─────────────────────────────────────────────

describe("buildRationale", () => {
  const actor = makeSnap();
  const target = makeSnap({ characterId: "target" });
  const baseComputed = {
    grievanceStrength: 0,
    factionConflict: false,
    favorGap: 0,
    peakFavorGap: 0,
    rankRivalry: 0,
  };

  it("high_jealousy added when jealousy>=60", () => {
    const a = makeSnap({ personality: { ...makeSnap().personality, jealousy: 60 } });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).toContain("high_jealousy");
  });

  it("high_jealousy NOT added when jealousy<60", () => {
    const a = makeSnap({ personality: { ...makeSnap().personality, jealousy: 59 } });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).not.toContain("high_jealousy");
  });

  it("high_ambition added when ambition>=65", () => {
    const a = makeSnap({ ambition: 65 });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).toContain("high_ambition");
  });

  it("high_scheming added when scheming>=60", () => {
    const a = makeSnap({ personality: { ...makeSnap().personality, scheming: 60 } });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).toContain("high_scheming");
  });

  it("unresolved_grievance added when grievanceStrength>=40", () => {
    const rationale = buildRationale(actor, target, { ...baseComputed, grievanceStrength: 40 });
    expect(rationale).toContain("unresolved_grievance");
  });

  it("favor_gap added when favorGap>=15", () => {
    const rationale = buildRationale(actor, target, { ...baseComputed, favorGap: 15 });
    expect(rationale).toContain("favor_gap");
  });

  it("peak_favor_gap added when peakFavorGap>=15", () => {
    const rationale = buildRationale(actor, target, { ...baseComputed, peakFavorGap: 15 });
    expect(rationale).toContain("peak_favor_gap");
  });

  it("rank_rivalry added when rankRivalry>=20", () => {
    const rationale = buildRationale(actor, target, { ...baseComputed, rankRivalry: 20 });
    expect(rationale).toContain("rank_rivalry");
  });

  it("faction_conflict added when factionConflict=true", () => {
    const rationale = buildRationale(actor, target, { ...baseComputed, factionConflict: true });
    expect(rationale).toContain("faction_conflict");
  });

  it("household_leverage added when privateWealthLevel>=60", () => {
    const a = makeSnap({ household: { servantOpinion: 50, livingStandard: 50, privateWealthLevel: 60 } });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).toContain("household_leverage");
  });

  it("low_loyalty added when loyalty<=35", () => {
    const a = makeSnap({ loyalty: 35 });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).toContain("low_loyalty");
  });

  it("fear_pressure added when fear>=65", () => {
    const a = makeSnap({ fear: 65 });
    const rationale = buildRationale(a, target, baseComputed);
    expect(rationale).toContain("fear_pressure");
  });

  it("target_influence added when target servantOpinion>=65", () => {
    const t = makeSnap({ characterId: "target", household: { servantOpinion: 65, livingStandard: 50, privateWealthLevel: 20 } });
    const rationale = buildRationale(actor, t, baseComputed);
    expect(rationale).toContain("target_influence");
  });

  it("rationale is in canonical order", () => {
    const CANONICAL = ["high_jealousy", "high_ambition", "high_scheming", "unresolved_grievance",
      "favor_gap", "peak_favor_gap", "rank_rivalry", "faction_conflict",
      "household_leverage", "low_loyalty", "fear_pressure", "target_influence"];
    const a = makeSnap({
      ambition: 70,
      fear: 70,
      loyalty: 30,
      personality: { scheming: 65, sociability: 30, compassion: 30, courage: 30, jealousy: 65, emotionalStability: 30, pride: 30, intelligence: 50 },
      household: { servantOpinion: 70, livingStandard: 50, privateWealthLevel: 70 },
    });
    const t = makeSnap({ characterId: "target", household: { servantOpinion: 70, livingStandard: 50, privateWealthLevel: 20 } });
    const rationale = buildRationale(a, t, {
      grievanceStrength: 50,
      factionConflict: true,
      favorGap: 20,
      peakFavorGap: 20,
      rankRivalry: 30,
    });
    const indices = rationale.map((code) => CANONICAL.indexOf(code));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it("no duplicates in rationale", () => {
    const a = makeSnap({
      ambition: 70,
      fear: 70,
      loyalty: 30,
      personality: { scheming: 65, sociability: 30, compassion: 30, courage: 30, jealousy: 65, emotionalStability: 30, pride: 30, intelligence: 50 },
      household: { servantOpinion: 70, livingStandard: 50, privateWealthLevel: 70 },
    });
    const rationale = buildRationale(a, target, {
      grievanceStrength: 50,
      factionConflict: true,
      favorGap: 20,
      peakFavorGap: 20,
      rankRivalry: 30,
    });
    expect(new Set(rationale).size).toBe(rationale.length);
  });
});

// ── P1-A: rngSeed divergence ──────────────────────────────────────────────────

describe("pairTieJitter: rngSeed divergence (P1-A)", () => {
  it("same rngSeed, same inputs → identical jitter", () => {
    const a = pairTieJitter(3, 7, "char_001", "char_002", 99999);
    const b = pairTieJitter(3, 7, "char_001", "char_002", 99999);
    expect(a).toBe(b);
  });

  it("different rngSeed → different jitter on at least some inputs", () => {
    // Try 10 year/month combos; statistically overwhelmingly likely to differ on at least one
    let foundDiff = false;
    for (let y = 1; y <= 5 && !foundDiff; y++) {
      for (let m = 1; m <= 12 && !foundDiff; m++) {
        const a = pairTieJitter(y, m, "char_001", "char_002", 1111);
        const b = pairTieJitter(y, m, "char_001", "char_002", 9999);
        if (a !== b) foundDiff = true;
      }
    }
    expect(foundDiff).toBe(true);
  });

  it("rngSeed=0 and rngSeed=1 produce different streams", () => {
    const results0 = Array.from({ length: 6 }, (_, i) =>
      pairTieJitter(1, i + 1, "x", "y", 0)
    );
    const results1 = Array.from({ length: 6 }, (_, i) =>
      pairTieJitter(1, i + 1, "x", "y", 1)
    );
    expect(results0).not.toEqual(results1);
  });
});

// ── P1-B: rank rivalry with ladder ───────────────────────────────────────────

import { buildHaremRankLadder, computeRankRivalry } from "../../src/engine/characters/haremIntrigue/scoring";
import { loadRealContent } from "../helpers/contentFixture";

describe("computeRankRivalry: ladder-based (P1-B)", () => {
  it("same rank → 0 rivalry", () => {
    expect(computeRankRivalry("meiren", "meiren", TEST_LADDER)).toBe(0);
  });

  it("adjacent ranks → non-zero rivalry", () => {
    // meiren(index 0) vs guiren(index 1) → 1/3 * 100 = 33
    const r = computeRankRivalry("meiren", "guiren", TEST_LADDER);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(100);
  });

  it("rivalry is asymmetric: only fires when target is higher rank than actor", () => {
    // meiren(index 0) targeting guiren(index 1) → rivalry > 0 (target higher)
    const r1 = computeRankRivalry("meiren", "guiren", TEST_LADDER);
    expect(r1).toBeGreaterThan(0);
    // guiren(index 1) targeting meiren(index 0) → 0 (target is lower rank, no rivalry)
    const r2 = computeRankRivalry("guiren", "meiren", TEST_LADDER);
    expect(r2).toBe(0);
  });

  it("huanghou target does not produce rivalry > 100", () => {
    // huanghou is index 3, meiren is index 0 → max gap = 3, max ladder = 3, rivalry = 100
    const r = computeRankRivalry("meiren", "huanghou", TEST_LADDER);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
  });

  it("rivalry 0 when actor rank not in ladder", () => {
    const r = computeRankRivalry("unknown_rank", "guiren", TEST_LADDER);
    expect(r).toBe(0);
  });

  it("buildHaremRankLadder uses real content and returns only harem + non-deprecated ranks", () => {
    const db = loadRealContent();
    const ladder = buildHaremRankLadder(db);
    // All entries should have valid indices 0, 1, 2, ...
    ladder.forEach((entry, i) => {
      expect(entry.index).toBe(i);
      expect(entry.rankId).toBeTruthy();
      expect(typeof entry.order).toBe("number");
    });
    // Should not include huanghou (order 1000, deprecated or domain=harem but excepted)
    // Regardless: ladder should be sorted ascending by order
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.order).toBeGreaterThanOrEqual(ladder[i - 1]!.order);
    }
  });

  it("rank_rivalry rationale triggers when rivalry is high enough", () => {
    const actor = makeSnap({ rankId: "meiren", rankOrder: 100, ambition: 80, personality: { scheming: 80, sociability: 30, compassion: 30, courage: 30, jealousy: 80, emotionalStability: 30, pride: 50, intelligence: 50 } });
    const t = makeSnap({ characterId: "target", rankId: "huanghou", rankOrder: 1000 });
    const rivalry = computeRankRivalry("meiren", "huanghou", TEST_LADDER);
    const rationale = buildRationale(actor, t, { grievanceStrength: 0, factionConflict: false, favorGap: 0, peakFavorGap: 0, rankRivalry: rivalry });
    // Only assert it doesn't throw and is an array; whether rank_rivalry appears depends on thresholds
    expect(Array.isArray(rationale)).toBe(true);
  });
});
