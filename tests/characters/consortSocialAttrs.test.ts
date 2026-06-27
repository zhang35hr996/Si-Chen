/**
 * Tests for the Social Simulation Layer — personality facets and household.
 *
 * Covers:
 *  1. PERSONALITY_DEFAULTS / HOUSEHOLD_DEFAULTS are valid 0–100 integers.
 *  2. resolveConsortRuntimeAttrs falls back to PERSONALITY_DEFAULTS when
 *     standing has no personality and content has no authored personality.
 *  3. resolveConsortRuntimeAttrs prefers authored hidden.personality over
 *     defaults when standing has no personality.
 *  4. resolveConsortRuntimeAttrs prefers standing.personality over authored.
 *  5. resolveConsortRuntimeAttrs falls back to HOUSEHOLD_DEFAULTS when
 *     standing has no household.
 *  6. resolveConsortRuntimeAttrs prefers standing.household over defaults.
 *  7. consortStandingExtras materialises personality from hidden.
 *  8. consortStandingExtras uses PERSONALITY_DEFAULTS when hidden has no personality.
 *  9. consortStandingExtras always materialises HOUSEHOLD_DEFAULTS.
 * 10. createNewGameState: authored consorts have personality + household in standing.
 * 11. Generated consorts (addGeneratedConsort) have personality + household in standing.
 */
import { describe, expect, it } from "vitest";
import {
  resolveConsortRuntimeAttrs,
  PERSONALITY_DEFAULTS,
  HOUSEHOLD_DEFAULTS,
} from "../../src/engine/characters/consortAttrs";
import { consortStandingExtras, createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, addGeneratedConsort } from "../../src/store/grandSelection";
import { loadRealContent } from "../helpers/contentFixture";
import type { ConsortPersonality, ConsortHousehold } from "../../src/engine/state/types";

const db = loadRealContent();

// ── 1. Defaults sanity ────────────────────────────────────────────────────────

describe("PERSONALITY_DEFAULTS", () => {
  const fields: (keyof ConsortPersonality)[] = [
    "intelligence", "scheming", "sociability", "compassion",
    "courage", "jealousy", "emotionalStability", "pride",
  ];

  it("has all eight fields in range [0, 100]", () => {
    for (const f of fields) {
      expect(PERSONALITY_DEFAULTS[f]).toBeGreaterThanOrEqual(0);
      expect(PERSONALITY_DEFAULTS[f]).toBeLessThanOrEqual(100);
      expect(Number.isInteger(PERSONALITY_DEFAULTS[f])).toBe(true);
    }
  });
});

describe("HOUSEHOLD_DEFAULTS", () => {
  const fields: (keyof ConsortHousehold)[] = [
    "servantOpinion", "livingStandard", "privateWealth",
  ];

  it("has all three fields in range [0, 100]", () => {
    for (const f of fields) {
      expect(HOUSEHOLD_DEFAULTS[f]).toBeGreaterThanOrEqual(0);
      expect(HOUSEHOLD_DEFAULTS[f]).toBeLessThanOrEqual(100);
      expect(Number.isInteger(HOUSEHOLD_DEFAULTS[f])).toBe(true);
    }
  });
});

// ── 2–4. Personality resolution order ────────────────────────────────────────

describe("resolveConsortRuntimeAttrs — personality", () => {
  const state = createNewGameState(db);

  it("returns PERSONALITY_DEFAULTS when standing and authored hidden both lack personality", () => {
    // Use a consort whose content JSON has no authored personality
    const attrs = resolveConsortRuntimeAttrs(db, state, "lu_huaijin");
    expect(attrs.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("prefers standing.personality over authored hidden.personality and defaults", () => {
    const overridePersonality: ConsortPersonality = {
      intelligence: 80, scheming: 70, sociability: 60, compassion: 55,
      courage: 45, jealousy: 35, emotionalStability: 65, pride: 50,
    };
    const customState = {
      ...state,
      standing: {
        ...state.standing,
        lu_huaijin: { ...state.standing["lu_huaijin"]!, personality: overridePersonality },
      },
    };
    const attrs = resolveConsortRuntimeAttrs(db, customState, "lu_huaijin");
    expect(attrs.personality).toEqual(overridePersonality);
  });
});

// ── 5–6. Household resolution order ──────────────────────────────────────────

describe("resolveConsortRuntimeAttrs — household", () => {
  const state = createNewGameState(db);

  it("returns HOUSEHOLD_DEFAULTS when standing has no household", () => {
    const stripped = {
      ...state,
      standing: {
        ...state.standing,
        lu_huaijin: { ...state.standing["lu_huaijin"]!, household: undefined },
      },
    };
    const attrs = resolveConsortRuntimeAttrs(db, stripped, "lu_huaijin");
    expect(attrs.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("prefers standing.household over defaults", () => {
    const overrideHousehold: ConsortHousehold = {
      servantOpinion: 90, livingStandard: 80, privateWealth: 60,
    };
    const customState = {
      ...state,
      standing: {
        ...state.standing,
        lu_huaijin: { ...state.standing["lu_huaijin"]!, household: overrideHousehold },
      },
    };
    const attrs = resolveConsortRuntimeAttrs(db, customState, "lu_huaijin");
    expect(attrs.household).toEqual(overrideHousehold);
  });
});

// ── 7–9. consortStandingExtras materialisation ───────────────────────────────

describe("consortStandingExtras — personality + household", () => {
  const startTime = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

  it("uses authored hidden.personality when present", () => {
    const authoredPersonality: ConsortPersonality = {
      intelligence: 75, scheming: 40, sociability: 65, compassion: 30,
      courage: 55, jealousy: 60, emotionalStability: 45, pride: 70,
    };
    const extras = consortStandingExtras(
      {
        kind: "consort",
        hidden: { affection: 50, fear: 30, ambition: 35, personality: authoredPersonality },
        attributes: { health: 80 },
      },
      startTime,
    );
    expect(extras.personality).toEqual(authoredPersonality);
  });

  it("uses PERSONALITY_DEFAULTS when hidden has no personality", () => {
    const extras = consortStandingExtras(
      { kind: "consort", hidden: { affection: 50, fear: 30, ambition: 35 }, attributes: { health: 80 } },
      startTime,
    );
    expect(extras.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("uses PERSONALITY_DEFAULTS when hidden is absent", () => {
    const extras = consortStandingExtras(
      { kind: "consort", attributes: { health: 80 } },
      startTime,
    );
    expect(extras.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("always materialises HOUSEHOLD_DEFAULTS", () => {
    const extras = consortStandingExtras(
      { kind: "consort", hidden: { affection: 50, fear: 30, ambition: 35 }, attributes: { health: 80 } },
      startTime,
    );
    expect(extras.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("does not add personality/household for non-consort characters", () => {
    const extras = consortStandingExtras({ kind: "official" }, startTime);
    expect(extras).toEqual({});
    expect((extras as Record<string, unknown>).personality).toBeUndefined();
    expect((extras as Record<string, unknown>).household).toBeUndefined();
  });
});

// ── 10. createNewGameState: authored consorts have personality + household ────

describe("createNewGameState — social simulation fields", () => {
  const state = createNewGameState(db);

  it("authored consort standing includes personality", () => {
    const standing = state.standing["lu_huaijin"];
    expect(standing).toBeDefined();
    expect(standing!.personality).toBeDefined();
    expect(standing!.personality).toEqual(PERSONALITY_DEFAULTS); // no authored personality in JSON
  });

  it("authored consort standing includes household at defaults", () => {
    const standing = state.standing["lu_huaijin"];
    expect(standing!.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("official standing does not include personality or household", () => {
    const official = state.standing["wei_sui"];
    expect(official).toBeDefined();
    expect((official as Record<string, unknown>).personality).toBeUndefined();
    expect((official as Record<string, unknown>).household).toBeUndefined();
  });
});

// ── 11. Generated consorts (addGeneratedConsort) have personality + household ─

describe("addGeneratedConsort — social simulation fields", () => {
  const state = createNewGameState(db);
  const year = state.calendar.year;
  const candidates = generateCandidates(db, state, year);
  const candidate = candidates[0]!;

  it("generated candidate content has authored personality in hidden", () => {
    expect(candidate.content.hidden?.personality).toBeDefined();
    const p = candidate.content.hidden!.personality!;
    for (const field of Object.keys(PERSONALITY_DEFAULTS) as (keyof ConsortPersonality)[]) {
      expect(p[field]).toBeGreaterThanOrEqual(0);
      expect(p[field]).toBeLessThanOrEqual(100);
    }
  });

  it("addGeneratedConsort standing includes generated personality", () => {
    const result = addGeneratedConsort(state, db, candidate.content, "guiren", 10, candidate.motherOfficialId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const standing = result.value.standing[candidate.content.id];
    expect(standing).toBeDefined();
    expect(standing!.personality).toEqual(candidate.content.hidden?.personality);
  });

  it("addGeneratedConsort standing includes household at defaults", () => {
    const result = addGeneratedConsort(state, db, candidate.content, "guiren", 10, candidate.motherOfficialId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const standing = result.value.standing[candidate.content.id];
    expect(standing!.household).toEqual(HOUSEHOLD_DEFAULTS);
  });
});
