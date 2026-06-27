import { describe, expect, it } from "vitest";
import {
  validateHaremIntriguePlan,
  validateHaremIntrigueOutcome,
} from "../../src/engine/characters/haremIntrigue/validation";
import {
  buildIntrigueConsequences,
} from "../../src/engine/characters/haremIntrigue/outcome";
import type { HaremIntriguePlan, HaremIntrigueOutcome, HaremIntrigueResolvedOutcome } from "../../src/engine/characters/haremIntrigue/types";
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
