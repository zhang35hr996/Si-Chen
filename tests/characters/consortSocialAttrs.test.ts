/**
 * Tests for the Social Simulation Layer — personality facets and household.
 *
 * Covers:
 *  1.  PERSONALITY_DEFAULTS / HOUSEHOLD_DEFAULTS are valid 0–100 integers.
 *  2.  resolveConsortRuntimeAttrs falls back to PERSONALITY_DEFAULTS when
 *      standing and content both lack personality.
 *  3.  resolveConsortRuntimeAttrs prefers authored hidden.personality (partial seed)
 *      over defaults when standing has no personality.
 *  4.  resolveConsortRuntimeAttrs prefers standing.personality over authored/defaults.
 *  5.  resolveConsortRuntimeAttrs falls back to HOUSEHOLD_DEFAULTS for absent household.
 *  6.  resolveConsortRuntimeAttrs prefers standing.household over defaults.
 *  7.  consortStandingExtras materialises personality from hidden seed.
 *  8.  consortStandingExtras uses PERSONALITY_DEFAULTS when hidden has no personality.
 *  9.  consortStandingExtras always materialises a fresh household at defaults.
 *  10. createNewGameState: authored consorts have personality + household in standing.
 *  11. addGeneratedConsort: personality + household written to standing.
 *  12. Reference isolation: multiple consorts do NOT share household or personality objects.
 *  13. Mutating one consort's household does NOT affect another's or the defaults.
 *  14. materializePersonality merges partial seed with defaults.
 *  15. materializePersonality(undefined) === PERSONALITY_DEFAULTS by value, not reference.
 *  16. createDefaultHousehold returns defaults by value, not the shared constant.
 *  17. Schema accepts partial authored personality (consortPersonalitySeedSchema).
 *  18. Schema rejects out-of-range values.
 *  19. Generated personality for a 'calculating' candidate has scheming >= 50 and intelligence >= 55.
 *  20. Generated personality for a 'cold' candidate has compassion <= 35 and sociability <= 35.
 *  21. Generated personality for a 'compassionate' candidate has compassion >= 65.
 *  22. Compiled dialogue payload contains complete personality and household.
 */
import { describe, expect, it } from "vitest";
import {
  resolveConsortRuntimeAttrs,
  materializePersonality,
  createDefaultHousehold,
  PERSONALITY_DEFAULTS,
  HOUSEHOLD_DEFAULTS,
} from "../../src/engine/characters/consortAttrs";
import { consortPersonalitySeedSchema, consortPersonalitySchema, consortHouseholdSchema } from "../../src/engine/content/schemas";
import { consortStandingExtras, createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, addGeneratedConsort } from "../../src/store/grandSelection";
import { loadRealContent } from "../helpers/contentFixture";
import type { ConsortPersonality, ConsortHousehold } from "../../src/engine/state/types";

const db = loadRealContent();

// ── 1. Defaults sanity ────────────────────────────────────────────────────────

describe("PERSONALITY_DEFAULTS", () => {
  const fields = Object.keys(PERSONALITY_DEFAULTS) as (keyof ConsortPersonality)[];
  it("has exactly 8 fields all in range [0, 100] as integers", () => {
    expect(fields).toHaveLength(8);
    for (const f of fields) {
      expect(PERSONALITY_DEFAULTS[f]).toBeGreaterThanOrEqual(0);
      expect(PERSONALITY_DEFAULTS[f]).toBeLessThanOrEqual(100);
      expect(Number.isInteger(PERSONALITY_DEFAULTS[f])).toBe(true);
    }
  });
});

describe("HOUSEHOLD_DEFAULTS", () => {
  const fields = Object.keys(HOUSEHOLD_DEFAULTS) as (keyof ConsortHousehold)[];
  it("has exactly 3 fields all in range [0, 100] as integers", () => {
    expect(fields).toHaveLength(3);
    for (const f of fields) {
      expect(HOUSEHOLD_DEFAULTS[f]).toBeGreaterThanOrEqual(0);
      expect(HOUSEHOLD_DEFAULTS[f]).toBeLessThanOrEqual(100);
      expect(Number.isInteger(HOUSEHOLD_DEFAULTS[f])).toBe(true);
    }
  });
  it("uses privateWealthLevel (not privateWealth)", () => {
    expect("privateWealthLevel" in HOUSEHOLD_DEFAULTS).toBe(true);
    expect("privateWealth" in HOUSEHOLD_DEFAULTS).toBe(false);
  });
});

// ── 2–4. Personality resolution order ────────────────────────────────────────

describe("resolveConsortRuntimeAttrs — personality", () => {
  const state = createNewGameState(db);

  it("falls back to PERSONALITY_DEFAULTS by value when no personality in standing or authored", () => {
    const stripped = {
      ...state,
      standing: { ...state.standing, lu_huaijin: { ...state.standing["lu_huaijin"]!, personality: undefined } },
    };
    const attrs = resolveConsortRuntimeAttrs(db, stripped, "lu_huaijin");
    expect(attrs.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("uses authored partial seed merged with defaults when standing lacks personality", () => {
    // Simulate a character whose authored hidden has a partial personality seed
    const overrideStanding = { ...state.standing["lu_huaijin"]!, personality: undefined };
    const customState = { ...state, standing: { ...state.standing, lu_huaijin: overrideStanding } };
    // generatedConsorts override is needed to inject partial personality into hidden
    const fakeConsort = {
      ...db.characters["lu_huaijin"]!,
      hidden: { ...db.characters["lu_huaijin"]!.hidden!, personality: { scheming: 80 } as Partial<ConsortPersonality> },
    };
    const customDb = { ...db, characters: { ...db.characters, lu_huaijin: fakeConsort } };
    const attrs = resolveConsortRuntimeAttrs(customDb as typeof db, customState, "lu_huaijin");
    // scheming from seed, everything else from defaults
    expect(attrs.personality.scheming).toBe(80);
    expect(attrs.personality.intelligence).toBe(PERSONALITY_DEFAULTS.intelligence);
    expect(attrs.personality.compassion).toBe(PERSONALITY_DEFAULTS.compassion);
  });

  it("prefers standing.personality over authored seed and defaults", () => {
    const override: ConsortPersonality = {
      intelligence: 80, scheming: 70, sociability: 60, compassion: 55,
      courage: 45, jealousy: 35, emotionalStability: 65, pride: 50,
    };
    const customState = {
      ...state,
      standing: { ...state.standing, lu_huaijin: { ...state.standing["lu_huaijin"]!, personality: override } },
    };
    expect(resolveConsortRuntimeAttrs(db, customState, "lu_huaijin").personality).toEqual(override);
  });
});

// ── 5–6. Household resolution order ──────────────────────────────────────────

describe("resolveConsortRuntimeAttrs — household", () => {
  const state = createNewGameState(db);

  it("falls back to HOUSEHOLD_DEFAULTS when standing has no household", () => {
    const stripped = {
      ...state,
      standing: { ...state.standing, lu_huaijin: { ...state.standing["lu_huaijin"]!, household: undefined } },
    };
    expect(resolveConsortRuntimeAttrs(db, stripped, "lu_huaijin").household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("prefers standing.household over defaults", () => {
    const override: ConsortHousehold = { servantOpinion: 90, livingStandard: 80, privateWealthLevel: 60 };
    const customState = {
      ...state,
      standing: { ...state.standing, lu_huaijin: { ...state.standing["lu_huaijin"]!, household: override } },
    };
    expect(resolveConsortRuntimeAttrs(db, customState, "lu_huaijin").household).toEqual(override);
  });
});

// ── 7–9. consortStandingExtras materialisation ───────────────────────────────

describe("consortStandingExtras — personality + household", () => {
  const startTime = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

  it("uses authored partial hidden.personality merged with defaults", () => {
    const extras = consortStandingExtras(
      { kind: "consort", hidden: { affection: 50, fear: 30, ambition: 35, personality: { scheming: 90 } }, attributes: { health: 80 } },
      startTime,
    );
    expect(extras.personality?.scheming).toBe(90);
    expect(extras.personality?.intelligence).toBe(PERSONALITY_DEFAULTS.intelligence);
  });

  it("uses PERSONALITY_DEFAULTS when hidden has no personality", () => {
    const extras = consortStandingExtras(
      { kind: "consort", hidden: { affection: 50, fear: 30, ambition: 35 }, attributes: { health: 80 } },
      startTime,
    );
    expect(extras.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("materialises a fresh HOUSEHOLD_DEFAULTS when hidden is absent", () => {
    const extras = consortStandingExtras({ kind: "consort", attributes: { health: 80 } }, startTime);
    expect(extras.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("does not add personality/household for non-consort characters", () => {
    const extras = consortStandingExtras({ kind: "official" }, startTime);
    expect(extras).toEqual({});
  });
});

// ── 10. createNewGameState: authored consorts ─────────────────────────────────

describe("createNewGameState — social simulation fields", () => {
  const state = createNewGameState(db);

  it("authored consort standing includes personality", () => {
    expect(state.standing["lu_huaijin"]?.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("authored consort standing includes household with privateWealthLevel", () => {
    expect(state.standing["lu_huaijin"]?.household).toEqual(HOUSEHOLD_DEFAULTS);
    expect(state.standing["lu_huaijin"]?.household?.privateWealthLevel).toBeDefined();
  });

  it("official standing does not include personality or household", () => {
    const official = state.standing["wei_sui"];
    expect((official as unknown as Record<string, unknown>).personality).toBeUndefined();
    expect((official as unknown as Record<string, unknown>).household).toBeUndefined();
  });
});

// ── 11. addGeneratedConsort: generated consorts ───────────────────────────────

describe("addGeneratedConsort — social simulation fields", () => {
  const state = createNewGameState(db);
  const candidates = generateCandidates(db, state, state.calendar.year);
  const candidate = candidates[0]!;

  it("generated candidate has authored personality in hidden", () => {
    const p = candidate.content.hidden?.personality;
    expect(p).toBeDefined();
    const keys = Object.keys(PERSONALITY_DEFAULTS) as (keyof ConsortPersonality)[];
    for (const field of keys) {
      expect(p![field]).toBeGreaterThanOrEqual(0);
      expect(p![field]).toBeLessThanOrEqual(100);
    }
  });

  it("addGeneratedConsort standing includes materialised personality", () => {
    const result = addGeneratedConsort(state, db, candidate.content, "guiren", 10, candidate.motherOfficialId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const standing = result.value.standing[candidate.content.id];
    expect(standing?.personality).toBeDefined();
    // Should equal the materialised seed (all 8 dims are generated, so it equals the seed)
    expect(standing?.personality).toEqual(materializePersonality(candidate.content.hidden?.personality));
  });

  it("addGeneratedConsort standing includes household at defaults", () => {
    const result = addGeneratedConsort(state, db, candidate.content, "guiren", 10, candidate.motherOfficialId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.standing[candidate.content.id]?.household).toEqual(HOUSEHOLD_DEFAULTS);
  });
});

// ── 12–13. Reference isolation ────────────────────────────────────────────────

describe("reference isolation — personality and household objects are independent", () => {
  it("two authored consorts have independent household objects", () => {
    const state = createNewGameState(db);
    const ids = Object.keys(state.standing).filter((id) => state.standing[id]?.household);
    if (ids.length < 2) return; // not enough consorts in test db to compare
    const a = state.standing[ids[0]!]!;
    const b = state.standing[ids[1]!]!;
    expect(a.household).not.toBe(b.household);
  });

  it("two authored consorts have independent personality objects", () => {
    const state = createNewGameState(db);
    const ids = Object.keys(state.standing).filter((id) => state.standing[id]?.personality);
    if (ids.length < 2) return;
    const a = state.standing[ids[0]!]!;
    const b = state.standing[ids[1]!]!;
    expect(a.personality).not.toBe(b.personality);
  });

  it("mutating one consort household does not affect another or HOUSEHOLD_DEFAULTS", () => {
    const state = createNewGameState(db);
    const ids = Object.keys(state.standing).filter((id) => state.standing[id]?.household);
    if (ids.length < 2) return;
    const originalB = state.standing[ids[1]!]!.household!.servantOpinion;
    const originalDefault = HOUSEHOLD_DEFAULTS.servantOpinion;

    // Mutate A's household (simulate an in-place effect)
    state.standing[ids[0]!]!.household!.servantOpinion = 99;

    // B and defaults are unaffected
    expect(state.standing[ids[1]!]!.household!.servantOpinion).toBe(originalB);
    expect(HOUSEHOLD_DEFAULTS.servantOpinion).toBe(originalDefault);
    expect(state.standing[ids[0]!]!.household!.servantOpinion).toBe(99);
  });
});

// ── 14–16. Factory functions ──────────────────────────────────────────────────

describe("materializePersonality", () => {
  it("with undefined seed returns PERSONALITY_DEFAULTS by value (not reference)", () => {
    const p = materializePersonality();
    expect(p).toEqual(PERSONALITY_DEFAULTS);
    expect(p).not.toBe(PERSONALITY_DEFAULTS);
  });

  it("merges partial seed over defaults", () => {
    const p = materializePersonality({ scheming: 90, pride: 80 });
    expect(p.scheming).toBe(90);
    expect(p.pride).toBe(80);
    expect(p.intelligence).toBe(PERSONALITY_DEFAULTS.intelligence);
    expect(p.compassion).toBe(PERSONALITY_DEFAULTS.compassion);
  });

  it("each call returns a fresh object", () => {
    expect(materializePersonality()).not.toBe(materializePersonality());
  });
});

describe("createDefaultHousehold", () => {
  it("returns HOUSEHOLD_DEFAULTS by value, not the shared constant reference", () => {
    const h = createDefaultHousehold();
    expect(h).toEqual(HOUSEHOLD_DEFAULTS);
    expect(h).not.toBe(HOUSEHOLD_DEFAULTS);
  });

  it("each call returns a fresh object", () => {
    expect(createDefaultHousehold()).not.toBe(createDefaultHousehold());
  });
});

// ── 17–18. Schema validation ──────────────────────────────────────────────────

describe("consortPersonalitySeedSchema — partial authored personality", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(consortPersonalitySeedSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial object with only some fields", () => {
    expect(consortPersonalitySeedSchema.safeParse({ scheming: 70, pride: 60 }).success).toBe(true);
  });

  it("accepts a complete personality object", () => {
    expect(consortPersonalitySeedSchema.safeParse(PERSONALITY_DEFAULTS).success).toBe(true);
  });

  it("rejects values outside [0, 100]", () => {
    expect(consortPersonalitySeedSchema.safeParse({ scheming: 101 }).success).toBe(false);
    expect(consortPersonalitySeedSchema.safeParse({ scheming: -1 }).success).toBe(false);
  });

  it("rejects non-integer values", () => {
    expect(consortPersonalitySeedSchema.safeParse({ scheming: 50.5 }).success).toBe(false);
  });
});

describe("consortPersonalitySchema — complete runtime personality", () => {
  it("rejects a partial object missing required fields", () => {
    expect(consortPersonalitySchema.safeParse({ scheming: 50 }).success).toBe(false);
  });

  it("accepts a complete object", () => {
    expect(consortPersonalitySchema.safeParse(PERSONALITY_DEFAULTS).success).toBe(true);
  });
});

describe("consortHouseholdSchema", () => {
  it("accepts HOUSEHOLD_DEFAULTS", () => {
    expect(consortHouseholdSchema.safeParse(HOUSEHOLD_DEFAULTS).success).toBe(true);
  });

  it("rejects if privateWealth (old name) is used instead of privateWealthLevel", () => {
    const bad = { servantOpinion: 50, livingStandard: 40, privateWealth: 20 };
    expect(consortHouseholdSchema.safeParse(bad).success).toBe(false);
  });
});

// ── 19–21. Trait / personality consistency ────────────────────────────────────

describe("generateCandidates — trait / personality consistency", () => {
  const state = createNewGameState(db);
  // Generate a larger batch across multiple years to cover trait variety
  const allCandidates = [
    ...generateCandidates(db, state, 1),
    ...generateCandidates(db, state, 4),
    ...generateCandidates(db, state, 7),
  ];

  it("'calculating' candidates have scheming >= 50 and intelligence >= 55", () => {
    const calculating = allCandidates.filter((c) =>
      c.content.profile.reactionTraits.includes("calculating"),
    );
    if (calculating.length === 0) return; // no such candidate in test batch
    for (const c of calculating) {
      const p = c.content.hidden?.personality;
      expect(p).toBeDefined();
      expect(p!.scheming).toBeGreaterThanOrEqual(50);
      expect(p!.intelligence).toBeGreaterThanOrEqual(55);
    }
  });

  it("'cold' candidates have compassion <= 35 and sociability <= 35", () => {
    const cold = allCandidates.filter((c) =>
      c.content.profile.reactionTraits.includes("cold"),
    );
    if (cold.length === 0) return;
    for (const c of cold) {
      const p = c.content.hidden?.personality;
      expect(p).toBeDefined();
      expect(p!.compassion).toBeLessThanOrEqual(35);
      expect(p!.sociability).toBeLessThanOrEqual(35);
    }
  });

  it("'compassionate' candidates have compassion >= 65", () => {
    const compassionate = allCandidates.filter((c) =>
      c.content.profile.reactionTraits.includes("compassionate"),
    );
    if (compassionate.length === 0) return;
    for (const c of compassionate) {
      const p = c.content.hidden?.personality;
      expect(p).toBeDefined();
      expect(p!.compassion).toBeGreaterThanOrEqual(65);
    }
  });

  it("all candidates have personality values within [0, 100]", () => {
    for (const c of allCandidates) {
      const p = c.content.hidden?.personality;
      expect(p).toBeDefined();
      for (const val of Object.values(p!)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ── 22. Dialogue payload contains complete personality + household ─────────────

describe("resolveConsortRuntimeAttrs — dialogue payload fields", () => {
  const state = createNewGameState(db);

  it("returns all 8 personality dims + all 3 household dims for a consort", () => {
    const attrs = resolveConsortRuntimeAttrs(db, state, "lu_huaijin");
    const pKeys: (keyof ConsortPersonality)[] = [
      "intelligence", "scheming", "sociability", "compassion",
      "courage", "jealousy", "emotionalStability", "pride",
    ];
    const hKeys: (keyof ConsortHousehold)[] = [
      "servantOpinion", "livingStandard", "privateWealthLevel",
    ];
    for (const k of pKeys) expect(attrs.personality[k]).toBeTypeOf("number");
    for (const k of hKeys) expect(attrs.household[k]).toBeTypeOf("number");
  });
});
