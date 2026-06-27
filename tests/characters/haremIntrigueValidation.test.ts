import { describe, expect, it } from "vitest";
import {
  validateHaremIntriguePlan,
  validateHaremIntrigueOutcome,
  validateParticipantSnapshot,
} from "../../src/engine/characters/haremIntrigue/validation";
import {
  buildIntrigueConsequences,
} from "../../src/engine/characters/haremIntrigue/outcome";
import type { HaremIntriguePlan, HaremIntrigueOutcome, HaremIntrigueResolvedOutcome, IntrigueParticipantSnapshot } from "../../src/engine/characters/haremIntrigue/types";
import { makeGameTime } from "../../src/engine/calendar/time";

const AT = makeGameTime(1, 3, "early");

function makeActor(id: string): HaremIntriguePlan["actorSnapshot"] {
  return {
    characterId: id,
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
    household: { servantOpinion: 50, livingStandard: 50, privateWealthLevel: 50 },
  };
}

function makeTarget(id: string): HaremIntriguePlan["targetSnapshot"] {
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
      scheming: 30,
      sociability: 60,
      compassion: 60,
      courage: 40,
      jealousy: 30,
      emotionalStability: 60,
      pride: 50,
      intelligence: 50,
    },
    household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 20 },
  };
}

function validPlan(overrides: Partial<HaremIntriguePlan> = {}): HaremIntriguePlan {
  return {
    sourceKey: "harem_intrigue:1:03",
    plannedAt: AT,
    year: 1,
    month: 3,
    actorId: "actor_001",
    targetId: "target_001",
    kind: "slander",
    motive: "jealousy",
    actorPropensity: 70,
    targetThreat: 60,
    priority: 65,
    potency: 55,
    secrecy: 50,
    grievanceStrength: 0,
    factionConflict: false,
    actorSnapshot: makeActor("actor_001"),
    targetSnapshot: makeTarget("target_001"),
    rationale: [],
    ...overrides,
  };
}

function validResolvedOutcome(plan: HaremIntriguePlan, success: boolean, discovered: boolean): HaremIntrigueResolvedOutcome {
  const consequences = buildIntrigueConsequences(plan, success, discovered);
  const successRoll = success ? 30 : 60;
  const successThreshold = 50;
  const discoveryRoll = discovered ? 20 : 70;
  const discoveryThreshold = 40;
  return {
    status: "resolved",
    resolvedAt: makeGameTime(1, 3, "mid"),
    successRoll,
    successThreshold,
    success,
    discoveryRoll,
    discoveryThreshold,
    discovered,
    consequences,
    knowledge: {
      actorKnowsOwnAction: true,
      targetKnowsInstigator: discovered,
      palacePublic: discovered,
    },
  };
}

// ── validateHaremIntriguePlan ─────────────────────────────────────────────

describe("validateHaremIntriguePlan - valid plan", () => {
  it("valid plan returns zero findings", () => {
    const plan = validPlan();
    expect(validateHaremIntriguePlan(plan)).toHaveLength(0);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_SOURCE_KEY", () => {
  it("malformed sourceKey", () => {
    const plan = validPlan({ sourceKey: "bad_key" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SOURCE_KEY")).toBe(true);
  });

  it("sourceKey without prefix", () => {
    const plan = validPlan({ sourceKey: "1:03" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SOURCE_KEY")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_TIME", () => {
  it("sourceKey year/month mismatch", () => {
    const plan = validPlan({ sourceKey: "harem_intrigue:5:03", year: 1, month: 3 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("plannedAt year mismatch", () => {
    const plan = validPlan({ plannedAt: { ...AT, year: 5 } });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("plannedAt month mismatch", () => {
    const plan = validPlan({ plannedAt: { ...AT, month: 7 } });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_SELF_TARGET", () => {
  it("actorId equals targetId", () => {
    const plan = validPlan({ actorId: "same_001", targetId: "same_001",
      actorSnapshot: makeActor("same_001"),
      targetSnapshot: { ...makeTarget("same_001"), characterId: "same_001" },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_SELF_TARGET")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_UNKNOWN_KIND", () => {
  it("unknown kind", () => {
    const plan = validPlan({ kind: "assassination" as HaremIntriguePlan["kind"] });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_UNKNOWN_KIND")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_UNKNOWN_MOTIVE", () => {
  it("unknown motive", () => {
    const plan = validPlan({ motive: "greed" as HaremIntriguePlan["motive"] });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_UNKNOWN_MOTIVE")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_SCORE", () => {
  it("actorPropensity out of range", () => {
    const plan = validPlan({ actorPropensity: 101 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });

  it("targetThreat negative", () => {
    const plan = validPlan({ targetThreat: -1 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });

  it("priority non-integer", () => {
    const plan = validPlan({ priority: 55.5 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_POTENCY", () => {
  it("potency below 10", () => {
    const plan = validPlan({ potency: 9 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_POTENCY")).toBe(true);
  });

  it("potency above 90", () => {
    const plan = validPlan({ potency: 91 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_POTENCY")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_SECRECY", () => {
  it("secrecy below 10", () => {
    const plan = validPlan({ secrecy: 9 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SECRECY")).toBe(true);
  });

  it("secrecy above 90", () => {
    const plan = validPlan({ secrecy: 91 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SECRECY")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_GRIEVANCE", () => {
  it("grievanceStrength negative", () => {
    const plan = validPlan({ grievanceStrength: -1 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_GRIEVANCE")).toBe(true);
  });

  it("grievanceStrength > 100", () => {
    const plan = validPlan({ grievanceStrength: 101 });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_GRIEVANCE")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_SNAPSHOT_ID_MISMATCH", () => {
  it("actorSnapshot.characterId mismatch", () => {
    const plan = validPlan({
      actorSnapshot: makeActor("wrong_actor_id"),
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_SNAPSHOT_ID_MISMATCH")).toBe(true);
  });

  it("targetSnapshot.characterId mismatch", () => {
    const plan = validPlan({
      targetSnapshot: { ...makeTarget("wrong_target_id") },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_SNAPSHOT_ID_MISMATCH")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_SNAPSHOT_VALUE", () => {
  it("actor favor negative", () => {
    const plan = validPlan({
      actorSnapshot: { ...makeActor("actor_001"), favor: -1 },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("actor peakFavor < favor", () => {
    const plan = validPlan({
      actorSnapshot: { ...makeActor("actor_001"), favor: 60, peakFavor: 40 },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("target fear > 100", () => {
    const plan = validPlan({
      targetSnapshot: { ...makeTarget("target_001"), fear: 101 },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_BAD_RATIONALE", () => {
  it("unknown rationale code", () => {
    const plan = validPlan({
      rationale: ["unknown_code" as HaremIntriguePlan["rationale"][number]],
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_RATIONALE")).toBe(true);
  });

  it("rationale not in canonical order", () => {
    const plan = validPlan({
      rationale: ["high_scheming", "high_jealousy"], // wrong order
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_RATIONALE")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_DUP_RATIONALE", () => {
  it("duplicate rationale code", () => {
    const plan = validPlan({
      rationale: ["high_jealousy", "high_jealousy"],
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_DUP_RATIONALE")).toBe(true);
  });
});

describe("validateHaremIntriguePlan - INTRIGUE_KIND_MOTIVE_MISMATCH", () => {
  it("false_accusation must have motive=resentment", () => {
    const plan = validPlan({ kind: "false_accusation", motive: "jealousy" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(true);
  });

  it("faction_pressure must have motive=faction", () => {
    const plan = validPlan({ kind: "faction_pressure", motive: "ambition" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(true);
  });

  it("steal_credit must have motive=ambition", () => {
    const plan = validPlan({ kind: "steal_credit", motive: "jealousy" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(true);
  });

  it("slander with jealousy is valid (no mismatch)", () => {
    const plan = validPlan({ kind: "slander", motive: "jealousy" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(false);
  });

  it("false_accusation with resentment is valid", () => {
    const plan = validPlan({ kind: "false_accusation", motive: "resentment" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(false);
  });

  it("faction_pressure with faction is valid", () => {
    const plan = validPlan({ kind: "faction_pressure", motive: "faction" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(false);
  });

  it("steal_credit with ambition is valid", () => {
    const plan = validPlan({ kind: "steal_credit", motive: "ambition" });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_KIND_MOTIVE_MISMATCH")).toBe(false);
  });
});

// ── validateHaremIntrigueOutcome ─────────────────────────────────────────────

describe("validateHaremIntrigueOutcome - valid resolved outcomes", () => {
  it("valid resolved (success+hidden) → zero findings", () => {
    const plan = validPlan();
    const outcome = validResolvedOutcome(plan, true, false);
    expect(validateHaremIntrigueOutcome(plan, outcome)).toHaveLength(0);
  });

  it("valid resolved (success+discovered) → zero findings", () => {
    const plan = validPlan();
    const outcome = validResolvedOutcome(plan, true, true);
    expect(validateHaremIntrigueOutcome(plan, outcome)).toHaveLength(0);
  });

  it("valid resolved (failure+hidden) → zero findings", () => {
    const plan = validPlan();
    const outcome = validResolvedOutcome(plan, false, false);
    expect(validateHaremIntrigueOutcome(plan, outcome)).toHaveLength(0);
  });

  it("valid resolved (failure+discovered) → zero findings", () => {
    const plan = validPlan();
    const outcome = validResolvedOutcome(plan, false, true);
    expect(validateHaremIntrigueOutcome(plan, outcome)).toHaveLength(0);
  });
});

describe("validateHaremIntrigueOutcome - valid cancelled outcome", () => {
  it("valid cancelled → zero findings", () => {
    const plan = validPlan();
    const outcome: HaremIntrigueOutcome = {
      status: "cancelled",
      resolvedAt: makeGameTime(1, 3, "mid"),
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
    expect(validateHaremIntrigueOutcome(plan, outcome)).toHaveLength(0);
  });
});

describe("validateHaremIntrigueOutcome - invalid resolved outcomes", () => {
  it("success inconsistency (roll >= threshold but success=true)", () => {
    const plan = validPlan();
    const outcome: HaremIntrigueResolvedOutcome = {
      ...validResolvedOutcome(plan, true, false),
      successRoll: 60,
      successThreshold: 50,
      success: true, // wrong: 60 >= 50 means failure
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });

  it("discovery inconsistency", () => {
    const plan = validPlan();
    const outcome: HaremIntrigueResolvedOutcome = {
      ...validResolvedOutcome(plan, false, false),
      discoveryRoll: 10,
      discoveryThreshold: 40,
      discovered: false, // wrong: 10 < 40 means discovered
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });

  it("targetKnowsInstigator mismatch with discovered", () => {
    const plan = validPlan();
    const outcome: HaremIntrigueResolvedOutcome = {
      ...validResolvedOutcome(plan, true, false),
      discovered: false,
      knowledge: {
        actorKnowsOwnAction: true,
        targetKnowsInstigator: true, // mismatch: discovered=false but this=true
        palacePublic: false,
      },
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });

  it("consequences mismatch with canonical builder", () => {
    const plan = validPlan();
    const outcome: HaremIntrigueResolvedOutcome = {
      ...validResolvedOutcome(plan, true, false),
      consequences: {
        standing: [{ characterId: "actor_001", favor: -99 }], // wrong
        household: [],
        nation: {},
      },
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });
});

describe("validateHaremIntrigueOutcome - invalid cancelled outcomes", () => {
  it("cancelled with non-empty standing → error", () => {
    const plan = validPlan();
    // Intentionally malformed: cast to bypass literal type constraint on consequences.standing
    const outcome = {
      status: "cancelled" as const,
      resolvedAt: makeGameTime(1, 3, "mid"),
      reason: "actor_unavailable" as const,
      consequences: {
        standing: [{ characterId: "actor_001", favor: -1 }],
        household: [] as [],
        nation: {} as Record<string, never>,
      },
      knowledge: { actorKnowsOwnAction: true as const, targetKnowsInstigator: false as const, palacePublic: false as const },
    } as unknown as HaremIntrigueOutcome;
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });

  it("cancelled with targetKnowsInstigator=true → error", () => {
    const plan = validPlan();
    const outcome: HaremIntrigueOutcome = {
      status: "cancelled",
      resolvedAt: makeGameTime(1, 3, "mid"),
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: true as false, palacePublic: false },
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SCORE")).toBe(true);
  });
});

// ── P2-A: postpartum boundary (strict <) ──────────────────────────────────

describe("validateHaremIntriguePlan: P2-A postpartum strict < (boundary tests via snapshot)", () => {
  // Note: postpartum is on GameState eligibility, not on the plan snapshot itself.
  // These are documented separately; plan validation doesn't check postpartum.
  // (eligibility.ts tests cover this; these tests confirm plan validation passes for valid plans)
  it("valid plan: no postpartum field in snapshot → no INTRIGUE_BAD_SNAPSHOT_VALUE", () => {
    const plan = validPlan();
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(false);
  });
});

// ── P2-B: GameTime validation ──────────────────────────────────────────────

describe("validateHaremIntriguePlan: P2-B GameTime validation", () => {
  it("year=0 in plannedAt → INTRIGUE_BAD_TIME", () => {
    const plan = validPlan({ plannedAt: makeGameTime(1, 3, "early"), year: 1, month: 3 });
    // Override plannedAt with year=0 via cast
    const badPlan = { ...plan, plannedAt: { year: 0, month: 3, period: "early" as const, dayIndex: 0 } };
    const findings = validateHaremIntriguePlan(badPlan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("month=13 in plannedAt → INTRIGUE_BAD_TIME", () => {
    const badPlan = { ...validPlan(), plannedAt: { year: 1, month: 13, period: "early" as const, dayIndex: 0 } };
    const findings = validateHaremIntriguePlan(badPlan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("period='noon' in plannedAt → INTRIGUE_BAD_TIME", () => {
    const badPlan = { ...validPlan(), plannedAt: { year: 1, month: 3, period: "noon" as never, dayIndex: 0 } };
    const findings = validateHaremIntriguePlan(badPlan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("valid GameTime → no INTRIGUE_BAD_TIME", () => {
    const plan = validPlan();
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(false);
  });
});

describe("validateHaremIntrigueOutcome: P2-B resolvedAt < plannedAt → INTRIGUE_BAD_TIME", () => {
  it("resolvedAt before plannedAt → INTRIGUE_BAD_TIME", () => {
    const plan = validPlan();
    // plannedAt = mid of year 1, month 3; resolvedAt = early of year 1, month 3 (before mid)
    const cons = buildIntrigueConsequences(plan, true, false);
    const outcome: HaremIntrigueOutcome = {
      status: "resolved",
      resolvedAt: makeGameTime(1, 3, "early"), // earlier than plannedAt (early)
      successRoll: 30,
      successThreshold: 50,
      success: true,
      discoveryRoll: 80,
      discoveryThreshold: 25,
      discovered: false,
      consequences: cons,
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
    // The plan's plannedAt is makeGameTime(1, 3, "early"), so resolvedAt must be >= plannedAt
    // Both are "early" on same day — dayIndex must differ for this to trigger
    // Craft resolvedAt with dayIndex BEFORE plannedAt's dayIndex
    const resolvedBefore = { year: 1, month: 2, period: "late" as const, dayIndex: 5 };
    const outcomeBefore = { ...outcome, resolvedAt: resolvedBefore };
    const findings = validateHaremIntrigueOutcome(plan, outcomeBefore);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("resolvedAt = plannedAt (same dayIndex) → no INTRIGUE_BAD_TIME from ordering", () => {
    const plan = validPlan();
    const cons = buildIntrigueConsequences(plan, true, false);
    const outcome: HaremIntrigueOutcome = {
      status: "resolved",
      resolvedAt: AT,  // same as plannedAt
      successRoll: 30,
      successThreshold: 50,
      success: true,
      discoveryRoll: 80,
      discoveryThreshold: 25,
      discovered: false,
      consequences: cons,
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(false);
  });
});

// ── P2-C: validateParticipantSnapshot ──────────────────────────────────────

describe("validateHaremIntriguePlan: P2-C snapshot validation", () => {
  it("actor snapshot rankId='' → INTRIGUE_BAD_SNAPSHOT_VALUE", () => {
    const plan = validPlan({ actorSnapshot: { ...makeActor("actor_001"), rankId: "" } });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("actor snapshot peakFavor < favor → INTRIGUE_BAD_SNAPSHOT_VALUE", () => {
    const plan = validPlan({ actorSnapshot: { ...makeActor("actor_001"), favor: 80, peakFavor: 50 } });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("actor snapshot intelligence out of range → INTRIGUE_BAD_SNAPSHOT_VALUE", () => {
    const actor = makeActor("actor_001");
    const badActor = { ...actor, personality: { ...actor.personality, intelligence: 150 } };
    const plan = validPlan({ actorSnapshot: badActor });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("target snapshot ID mismatch → INTRIGUE_SNAPSHOT_ID_MISMATCH", () => {
    const plan = validPlan({ targetSnapshot: { ...makeTarget("wrong_id") } });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_SNAPSHOT_ID_MISMATCH")).toBe(true);
  });

  it("valid snapshots → no snapshot errors", () => {
    const plan = validPlan();
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) =>
      f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE" || f.code === "INTRIGUE_SNAPSHOT_ID_MISMATCH"
    )).toBe(false);
  });
});

// ── P1-A: dayIndex consistency ──────────────────────────────────────────────

describe("validateHaremIntriguePlan: P1-A dayIndex consistency", () => {
  it("plannedAt.dayIndex inconsistent with year/month/period → INTRIGUE_BAD_TIME", () => {
    // year=1, month=3, period="early" → expected dayIndex=6; we supply 0
    const plan = validPlan({
      plannedAt: { year: 1, month: 3, period: "early" as const, dayIndex: 0 },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("makeGameTime(1, 3, 'early') produces consistent GameTime → no INTRIGUE_BAD_TIME", () => {
    const plan = validPlan(); // plannedAt = makeGameTime(1, 3, "early")
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(false);
  });

  it("plannedAt.dayIndex off by 1 → INTRIGUE_BAD_TIME", () => {
    // Expected dayIndex for year=1, month=3, early = 6; supply 7
    const plan = validPlan({
      plannedAt: { year: 1, month: 3, period: "early" as const, dayIndex: 7 },
    });
    const findings = validateHaremIntriguePlan(plan);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });
});

// ── P2-Fix1: validateParticipantSnapshot defensive guards ──────────────────

describe("validateParticipantSnapshot: malformed persisted snapshots do not throw", () => {
  const EXPECTED_ID = "char_001";

  it("snap={} → INTRIGUE_BAD_SNAPSHOT_VALUE findings, does not throw", () => {
    const snap = {} as unknown as IntrigueParticipantSnapshot;
    let findings: ReturnType<typeof validateParticipantSnapshot>;
    expect(() => {
      findings = validateParticipantSnapshot("actor", snap, EXPECTED_ID);
    }).not.toThrow();
    expect(findings!.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("snap.personality=null → INTRIGUE_BAD_SNAPSHOT_VALUE for personality, does not throw", () => {
    const snap = {
      characterId: EXPECTED_ID,
      rankId: "meiren",
      rankOrder: 100,
      favor: 30,
      peakFavor: 50,
      affection: 50,
      fear: 30,
      ambition: 50,
      loyalty: 50,
      personality: null,
      household: { servantOpinion: 50, livingStandard: 50, privateWealthLevel: 50 },
    } as unknown as IntrigueParticipantSnapshot;
    let findings: ReturnType<typeof validateParticipantSnapshot>;
    expect(() => {
      findings = validateParticipantSnapshot("actor", snap, EXPECTED_ID);
    }).not.toThrow();
    expect(findings!.some(
      (f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE" && f.message.includes("personality"),
    )).toBe(true);
  });

  it("snap.household=undefined → INTRIGUE_BAD_SNAPSHOT_VALUE for household, does not throw", () => {
    const snap = {
      characterId: EXPECTED_ID,
      rankId: "meiren",
      rankOrder: 100,
      favor: 30,
      peakFavor: 50,
      affection: 50,
      fear: 30,
      ambition: 50,
      loyalty: 50,
      personality: {
        scheming: 50, sociability: 50, compassion: 50, courage: 50,
        jealousy: 50, emotionalStability: 50, pride: 50, intelligence: 50,
      },
      household: undefined,
    } as unknown as IntrigueParticipantSnapshot;
    let findings: ReturnType<typeof validateParticipantSnapshot>;
    expect(() => {
      findings = validateParticipantSnapshot("target", snap, EXPECTED_ID);
    }).not.toThrow();
    expect(findings!.some(
      (f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE" && f.message.includes("household"),
    )).toBe(true);
  });

  it("snap=null → INTRIGUE_BAD_SNAPSHOT_VALUE, early return, does not throw", () => {
    const snap = null as unknown as IntrigueParticipantSnapshot;
    let findings: ReturnType<typeof validateParticipantSnapshot>;
    expect(() => {
      findings = validateParticipantSnapshot("actor", snap, EXPECTED_ID);
    }).not.toThrow();
    expect(findings!.some((f) => f.code === "INTRIGUE_BAD_SNAPSHOT_VALUE")).toBe(true);
  });

  it("valid snapshot → no personality/household findings", () => {
    const snap: IntrigueParticipantSnapshot = {
      characterId: EXPECTED_ID,
      rankId: "meiren",
      rankOrder: 100,
      favor: 30,
      peakFavor: 50,
      affection: 50,
      fear: 30,
      ambition: 50,
      loyalty: 50,
      personality: {
        scheming: 50, sociability: 50, compassion: 50, courage: 50,
        jealousy: 50, emotionalStability: 50, pride: 50, intelligence: 50,
      },
      household: { servantOpinion: 50, livingStandard: 50, privateWealthLevel: 50 },
    };
    const findings = validateParticipantSnapshot("actor", snap, EXPECTED_ID);
    expect(findings.some(
      (f) => f.message.includes("personality") || f.message.includes("household"),
    )).toBe(false);
    expect(findings).toHaveLength(0);
  });
});

describe("validateHaremIntrigueOutcome: P1-A resolvedAt.dayIndex consistency", () => {
  it("resolvedAt.dayIndex inconsistent with year/month/period → INTRIGUE_BAD_TIME", () => {
    const plan = validPlan();
    const cons = buildIntrigueConsequences(plan, true, false);
    // year=1, month=3, period="mid" → expected dayIndex=7; we supply 0
    const outcome: HaremIntrigueOutcome = {
      status: "resolved",
      resolvedAt: { year: 1, month: 3, period: "mid" as const, dayIndex: 0 },
      successRoll: 30,
      successThreshold: 50,
      success: true,
      discoveryRoll: 80,
      discoveryThreshold: 25,
      discovered: false,
      consequences: cons,
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(true);
  });

  it("resolvedAt from makeGameTime is consistent → no INTRIGUE_BAD_TIME on time field", () => {
    const plan = validPlan();
    const outcome = validResolvedOutcome(plan, true, false);
    // resolvedAt = makeGameTime(1, 3, "mid") which is consistent
    const findings = validateHaremIntrigueOutcome(plan, outcome);
    expect(findings.some((f) => f.code === "INTRIGUE_BAD_TIME")).toBe(false);
  });
});
