/**
 * Group B: calcFrontierPressureDelta — military/governance/publicSupport modifiers, clamp, determinism.
 *
 * Raw drift values for specific (year, rngSeed) are deterministic (FNV1a64-based):
 * - year=1, seed=1: rawDrift=0
 * - year=1, seed=2: rawDrift=-3  (useful for negative clamp test)
 * - year=3, seed=3: rawDrift=7
 */
import { describe, expect, it } from "vitest";
import { calcFrontierPressureDelta } from "../../src/engine/court/frontierAssessment";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function makeState(overrides: {
  military?: number;
  governance?: number;
  publicSupport?: number;
  rngSeed?: number;
}): GameState {
  const seed = overrides.rngSeed ?? 1;
  const base = createNewGameState(db, seed);
  return {
    ...base,
    rngSeed: seed,
    resources: {
      ...base.resources,
      nation: {
        ...base.resources.nation,
        military: overrides.military ?? 50,
        governance: overrides.governance ?? 50,
        publicSupport: overrides.publicSupport ?? 50,
      },
    },
  };
}

// ── Military modifier ranges ───────────────────────────────────────────────────

describe("Group B: calcFrontierPressureDelta — military modifiers", () => {
  it("military=20 → militaryModifier === +8 (≤25 bracket)", () => {
    const state = makeState({ military: 20 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(8);
  });

  it("military=35 → militaryModifier === +5 (26–40 bracket)", () => {
    const state = makeState({ military: 35 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(5);
  });

  it("military=50 → militaryModifier === +2 (41–55 bracket)", () => {
    const state = makeState({ military: 50 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(2);
  });

  it("military=60 → militaryModifier === 0 (neutral 56–64 range)", () => {
    const state = makeState({ military: 60 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(0);
  });

  it("military=70 → militaryModifier === -3 (65–79 bracket)", () => {
    const state = makeState({ military: 70 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(-3);
  });

  it("military=85 → militaryModifier === -5 (≥80 bracket)", () => {
    const state = makeState({ military: 85 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(-5);
  });

  it("military=25 (boundary) → militaryModifier === +8 (still ≤25)", () => {
    const state = makeState({ military: 25 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(8);
  });

  it("military=80 (boundary) → militaryModifier === -5 (≥80)", () => {
    const state = makeState({ military: 80 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.militaryModifier).toBe(-5);
  });
});

// ── Governance modifiers ───────────────────────────────────────────────────────

describe("Group B: calcFrontierPressureDelta — governance modifiers", () => {
  it("governance=30 (<35) → governanceModifier === +3", () => {
    const state = makeState({ governance: 30 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.governanceModifier).toBe(3);
  });

  it("governance=50 (neutral) → governanceModifier === 0", () => {
    const state = makeState({ governance: 50 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.governanceModifier).toBe(0);
  });

  it("governance=75 (>70) → governanceModifier === -2", () => {
    const state = makeState({ governance: 75 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.governanceModifier).toBe(-2);
  });

  it("governance=35 (boundary, not <35) → governanceModifier === 0", () => {
    const state = makeState({ governance: 35 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.governanceModifier).toBe(0);
  });

  it("governance=70 (boundary, not >70) → governanceModifier === 0", () => {
    const state = makeState({ governance: 70 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.governanceModifier).toBe(0);
  });
});

// ── PublicSupport modifiers ────────────────────────────────────────────────────

describe("Group B: calcFrontierPressureDelta — publicSupport modifiers", () => {
  it("publicSupport=25 (<30) → publicSupportModifier === +2", () => {
    const state = makeState({ publicSupport: 25 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.publicSupportModifier).toBe(2);
  });

  it("publicSupport=50 (≥30) → publicSupportModifier === 0", () => {
    const state = makeState({ publicSupport: 50 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.publicSupportModifier).toBe(0);
  });

  it("publicSupport=29 (boundary, <30) → publicSupportModifier === +2", () => {
    const state = makeState({ publicSupport: 29 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.publicSupportModifier).toBe(2);
  });

  it("publicSupport=30 (boundary, not <30) → publicSupportModifier === 0", () => {
    const state = makeState({ publicSupport: 30 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.publicSupportModifier).toBe(0);
  });
});

// ── Total delta clamp ─────────────────────────────────────────────────────────

describe("Group B: calcFrontierPressureDelta — total delta clamp", () => {
  it("positive clamp: modifiers+rawDrift > 10 → pressureDelta === 10", () => {
    // seed=1, year=1: rawDrift=0
    // military=20 (+8), governance=30 (+3), publicSupport=25 (+2) → sum=13
    // total = 0 + 13 = 13 → clamped to 10
    const state = makeState({ military: 20, governance: 30, publicSupport: 25, rngSeed: 1 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.rawDrift).toBe(0);
    expect(result.pressureDelta).toBe(10);
  });

  it("negative clamp: modifiers+rawDrift = -10 → pressureDelta === -10", () => {
    // seed=2, year=1: rawDrift=-3
    // military=85 (-5), governance=75 (-2), publicSupport=50 (0) → sum=-7
    // total = -3 + (-7) = -10 → clamped to -10 (boundary)
    const state = makeState({ military: 85, governance: 75, publicSupport: 50, rngSeed: 2 });
    const result = calcFrontierPressureDelta(state, 1);
    expect(result.rawDrift).toBe(-3);
    expect(result.pressureDelta).toBe(-10);
  });

  it("pressureDelta always in [-10, +10] range", () => {
    // Test multiple seeds and years
    for (let seed = 1; seed <= 5; seed++) {
      for (let year = 1; year <= 5; year++) {
        const state = makeState({ rngSeed: seed });
        const result = calcFrontierPressureDelta(state, year);
        expect(result.pressureDelta).toBeGreaterThanOrEqual(-10);
        expect(result.pressureDelta).toBeLessThanOrEqual(10);
      }
    }
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("Group B: calcFrontierPressureDelta — determinism", () => {
  it("same seed+year → same rawDrift (deterministic)", () => {
    const state = makeState({ rngSeed: 1 });
    const r1 = calcFrontierPressureDelta(state, 1);
    const r2 = calcFrontierPressureDelta(state, 1);
    expect(r1.rawDrift).toBe(r2.rawDrift);
    expect(r1.pressureDelta).toBe(r2.pressureDelta);
  });

  it("different year → potentially different rawDrift", () => {
    // seed=1: year=1 → rawDrift=0, year=2 → rawDrift=1 (different)
    const state = makeState({ rngSeed: 1 });
    const r1 = calcFrontierPressureDelta(state, 1);
    const r2 = calcFrontierPressureDelta(state, 2);
    // These happen to differ for seed=1
    expect(r1.rawDrift).toBe(0);
    expect(r2.rawDrift).toBe(1);
    expect(r1.rawDrift).not.toBe(r2.rawDrift);
  });

  it("different seed → same year can produce different rawDrift", () => {
    // seed=1, year=1: rawDrift=0
    // seed=2, year=1: rawDrift=-3
    const s1 = makeState({ rngSeed: 1 });
    const s2 = makeState({ rngSeed: 2 });
    const r1 = calcFrontierPressureDelta(s1, 1);
    const r2 = calcFrontierPressureDelta(s2, 1);
    expect(r1.rawDrift).toBe(0);
    expect(r2.rawDrift).toBe(-3);
    expect(r1.rawDrift).not.toBe(r2.rawDrift);
  });
});
