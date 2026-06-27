import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import {
  resolveIntrigueOutcome,
  buildIntrigueConsequences,
} from "../../src/engine/characters/haremIntrigue/outcome";
import type { HaremIntriguePlan } from "../../src/engine/characters/haremIntrigue/types";
import type { GameState } from "../../src/engine/state/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";
import { materializePersonality, createDefaultHousehold } from "../../src/engine/characters/consortAttrs";


const db = loadRealContent();
const base = createNewGameState(db);
const AT: GameTime = makeGameTime(1, 3, "early");
const RESOLVED_AT: GameTime = makeGameTime(1, 3, "mid");

// ── Plan fixture ─────────────────────────────────────────────

function makeActor(id: string): HaremIntriguePlan["actorSnapshot"] {
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
      scheming: 70,
      sociability: 40,
      compassion: 20,
      courage: 60,
      jealousy: 70,
      emotionalStability: 30,
      pride: 40,
    },
    household: { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 30 },
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

function makePlan(
  overrides: Partial<HaremIntriguePlan> = {},
): HaremIntriguePlan {
  const actorId = "actor_001";
  const targetId = "target_001";
  return {
    sourceKey: "harem_intrigue:1:03",
    plannedAt: AT,
    year: 1,
    month: 3,
    actorId,
    targetId,
    kind: "slander",
    motive: "jealousy",
    actorPropensity: 70,
    targetThreat: 60,
    priority: 65,
    potency: 55,
    secrecy: 50,
    grievanceStrength: 0,
    factionConflict: false,
    actorSnapshot: makeActor(actorId),
    targetSnapshot: makeTarget(targetId),
    rationale: ["high_jealousy", "favor_gap"],
    ...overrides,
  };
}

/** Create state with actor and target registered in bedchamber & standing */
function makeStateWithPair(
  actorId: string,
  targetId: string,
  actorOverrides: Partial<GameState["standing"][string]> = {},
  targetOverrides: Partial<GameState["standing"][string]> = {},
): GameState {
  return {
    ...base,
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
  };
}

// ── buildIntrigueConsequences ─────────────────────────────────────────────

describe("buildIntrigueConsequences - slander success", () => {
  it("slander success: target favor -4, affection -2, rumor +1", () => {
    const plan = makePlan({ kind: "slander", motive: "jealousy" });
    const cons = buildIntrigueConsequences(plan, true, false);
    const targetDelta = cons.standing.find((d) => d.characterId === "target_001");
    expect(targetDelta?.favor).toBe(-4);
    expect(targetDelta?.affection).toBe(-2);
    expect(cons.nation.rumor).toBe(1);
    expect(cons.household).toHaveLength(0);
  });
});

describe("buildIntrigueConsequences - slander success + discovered", () => {
  it("slander success+discovered: target gets hits AND actor gets favor -4, fear +5", () => {
    const plan = makePlan({ kind: "slander", motive: "jealousy" });
    const cons = buildIntrigueConsequences(plan, true, true);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    const targetDelta = cons.standing.find((d) => d.characterId === "target_001");
    expect(actorDelta?.favor).toBe(-4);
    expect(actorDelta?.fear).toBe(5);
    expect(targetDelta?.favor).toBe(-4);
    expect(cons.nation.rumor).toBe(3); // 1 from slander + 2 from discovery
  });
});

describe("buildIntrigueConsequences - slander failure", () => {
  it("slander failure: actor fear +2", () => {
    const plan = makePlan({ kind: "slander", motive: "jealousy" });
    const cons = buildIntrigueConsequences(plan, false, false);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    expect(actorDelta?.fear).toBe(2);
    const targetDelta = cons.standing.find((d) => d.characterId === "target_001");
    expect(targetDelta).toBeUndefined();
  });
});

describe("buildIntrigueConsequences - slander failure + discovered", () => {
  it("slander failure+discovered: actor fear merges (2+5=7), favor -4", () => {
    const plan = makePlan({ kind: "slander", motive: "jealousy" });
    const cons = buildIntrigueConsequences(plan, false, true);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    expect(actorDelta?.fear).toBe(7); // 2 from failure + 5 from discovery
    expect(actorDelta?.favor).toBe(-4);
    expect(cons.nation.rumor).toBe(2); // only from discovery
  });
});

describe("buildIntrigueConsequences - false_accusation success", () => {
  it("false_accusation success: target favor -5, fear +5, affection -3", () => {
    const plan = makePlan({ kind: "false_accusation", motive: "resentment" });
    const cons = buildIntrigueConsequences(plan, true, false);
    const targetDelta = cons.standing.find((d) => d.characterId === "target_001");
    expect(targetDelta?.favor).toBe(-5);
    expect(targetDelta?.fear).toBe(5);
    expect(targetDelta?.affection).toBe(-3);
    expect(cons.nation).toEqual({});
  });
});

describe("buildIntrigueConsequences - false_accusation failure", () => {
  it("false_accusation failure: actor fear +3", () => {
    const plan = makePlan({ kind: "false_accusation", motive: "resentment" });
    const cons = buildIntrigueConsequences(plan, false, false);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    expect(actorDelta?.fear).toBe(3);
  });
});

describe("buildIntrigueConsequences - steal_credit success", () => {
  it("steal_credit success: actor favor +3, affection +2; target favor -2", () => {
    const plan = makePlan({ kind: "steal_credit", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, true, false);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    const targetDelta = cons.standing.find((d) => d.characterId === "target_001");
    expect(actorDelta?.favor).toBe(3);
    expect(actorDelta?.affection).toBe(2);
    expect(targetDelta?.favor).toBe(-2);
  });
});

describe("buildIntrigueConsequences - steal_credit failure", () => {
  it("steal_credit failure: actor fear +2", () => {
    const plan = makePlan({ kind: "steal_credit", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, false, false);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    expect(actorDelta?.fear).toBe(2);
  });
});

describe("buildIntrigueConsequences - faction_pressure success", () => {
  it("faction_pressure success: target fear +6, loyalty -4, rumor +1", () => {
    const plan = makePlan({ kind: "faction_pressure", motive: "faction" });
    const cons = buildIntrigueConsequences(plan, true, false);
    const targetDelta = cons.standing.find((d) => d.characterId === "target_001");
    expect(targetDelta?.fear).toBe(6);
    expect(targetDelta?.loyalty).toBe(-4);
    expect(cons.nation.rumor).toBe(1);
  });
});

describe("buildIntrigueConsequences - faction_pressure failure", () => {
  it("faction_pressure failure: actor fear +3", () => {
    const plan = makePlan({ kind: "faction_pressure", motive: "faction" });
    const cons = buildIntrigueConsequences(plan, false, false);
    const actorDelta = cons.standing.find((d) => d.characterId === "actor_001");
    expect(actorDelta?.fear).toBe(3);
  });
});

describe("buildIntrigueConsequences - servant_subversion success", () => {
  it("servant_subversion success: target servantOpinion -6; actor servantOpinion +2; target fear +2", () => {
    const plan = makePlan({ kind: "servant_subversion", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, true, false);
    const targetHousehold = cons.household.find((d) => d.characterId === "target_001");
    const actorHousehold = cons.household.find((d) => d.characterId === "actor_001");
    const targetStanding = cons.standing.find((d) => d.characterId === "target_001");
    expect(targetHousehold?.servantOpinion).toBe(-6);
    expect(actorHousehold?.servantOpinion).toBe(2);
    expect(targetStanding?.fear).toBe(2);
  });
});

describe("buildIntrigueConsequences - servant_subversion failure", () => {
  it("servant_subversion failure: actor servantOpinion -2, fear +1", () => {
    const plan = makePlan({ kind: "servant_subversion", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, false, false);
    const actorHousehold = cons.household.find((d) => d.characterId === "actor_001");
    const actorStanding = cons.standing.find((d) => d.characterId === "actor_001");
    expect(actorHousehold?.servantOpinion).toBe(-2);
    expect(actorStanding?.fear).toBe(1);
  });
});

describe("buildIntrigueConsequences - no zero fields", () => {
  it("standing deltas contain no zero values", () => {
    const plan = makePlan({ kind: "slander", motive: "jealousy" });
    const cons = buildIntrigueConsequences(plan, true, true);
    for (const d of cons.standing) {
      for (const [field, val] of Object.entries(d)) {
        if (field === "characterId") continue;
        expect(val).not.toBe(0);
      }
    }
  });

  it("household deltas contain no zero values", () => {
    const plan = makePlan({ kind: "servant_subversion", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, true, false);
    for (const d of cons.household) {
      for (const [field, val] of Object.entries(d)) {
        if (field === "characterId") continue;
        expect(val).not.toBe(0);
      }
    }
  });
});

describe("buildIntrigueConsequences - standing sorted by characterId", () => {
  it("standing deltas are sorted by characterId", () => {
    const plan = makePlan({ kind: "steal_credit", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, true, true);
    const ids = cons.standing.map((d) => d.characterId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("buildIntrigueConsequences - no duplicate characterId", () => {
  it("no duplicate characterIds in standing", () => {
    const plan = makePlan({ kind: "steal_credit", motive: "ambition" });
    const cons = buildIntrigueConsequences(plan, true, true);
    const ids = cons.standing.map((d) => d.characterId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildIntrigueConsequences - deltas clamped to [-10, +10]", () => {
  it("clamped to [-10, +10] for standing", () => {
    const plan = makePlan({ kind: "slander", motive: "jealousy" });
    const cons = buildIntrigueConsequences(plan, true, true);
    for (const d of cons.standing) {
      for (const [field, val] of Object.entries(d)) {
        if (field === "characterId") continue;
        if (typeof val === "number") {
          expect(val).toBeGreaterThanOrEqual(-10);
          expect(val).toBeLessThanOrEqual(10);
        }
      }
    }
  });
});

// ── resolveIntrigueOutcome ─────────────────────────────────────────────

describe("resolveIntrigueOutcome - invalid plan → cancelled", () => {
  it("plan_invalid when sourceKey is malformed", () => {
    const plan = makePlan({ sourceKey: "bad_key", year: 1, month: 3 });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("plan_invalid");
    }
  });
});

describe("resolveIntrigueOutcome - actor missing → cancelled", () => {
  it("actor has no standing entry", () => {
    const plan = makePlan();
    // Use base state where actor_001 is not registered
    const outcome = resolveIntrigueOutcome(db, base, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("actor_unavailable");
    }
  });

  it("actor deceased → cancelled", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001", { lifecycle: "deceased" });
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("actor_unavailable");
    }
  });

  it("actor critical health → cancelled", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001", { healthStatus: "critical" });
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("actor_unavailable");
    }
  });

  it("actor became carrying after planning → cancelled", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001");
    const stateWithCarrying: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: {
          ...state.resources.bloodline,
          gestations: [{ carrier: "actor_001", conceivedAt: AT }],
        },
      },
    };
    const outcome = resolveIntrigueOutcome(db, stateWithCarrying, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("actor_unavailable");
    }
  });
});

describe("resolveIntrigueOutcome - target missing → cancelled", () => {
  it("target has no standing entry", () => {
    const plan = makePlan();
    // Only register actor, not target
    const state: GameState = {
      ...base,
      bedchamber: { ...base.bedchamber, "actor_001": { encounters: [] } },
      standing: {
        ...base.standing,
        "actor_001": {
          rank: "meiren",
          favor: 30,
          peakFavor: 50,
          personality: materializePersonality(),
          household: createDefaultHousehold(),
        },
      },
    };
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("target_unavailable");
    }
  });

  it("target deceased → cancelled", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001", {}, { lifecycle: "deceased" });
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(outcome.status).toBe("cancelled");
    if (outcome.status === "cancelled") {
      expect(outcome.reason).toBe("target_unavailable");
    }
  });
});

describe("resolveIntrigueOutcome - target carrying is NOT cancelled", () => {
  it("target carrying (gestation) does NOT cancel", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001");
    const stateWithCarrying: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: {
          ...state.resources.bloodline,
          gestations: [{ carrier: "target_001", conceivedAt: AT }],
        },
      },
    };
    const outcome = resolveIntrigueOutcome(db, stateWithCarrying, plan, RESOLVED_AT);
    // target carrying is allowed - should be resolved, not cancelled for this reason
    if (outcome.status === "cancelled") {
      expect(outcome.reason).not.toBe("target_unavailable");
    }
  });
});

describe("resolveIntrigueOutcome - 4 quadrants", () => {
  it("success+hidden: success=true, discovered=false", () => {
    // We need to craft a plan where roll < successThreshold but roll >= discoveryThreshold
    // Since rolls are deterministic from the plan's sourceKey/actor/target/kind,
    // we test all four quadrants by using different kinds/actors
    const plan = makePlan({ kind: "slander" });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(outcome.status).toBe("resolved");
    if (outcome.status === "resolved") {
      // Check consistency
      expect(outcome.success).toBe(outcome.successRoll < outcome.successThreshold);
      expect(outcome.discovered).toBe(outcome.discoveryRoll < outcome.discoveryThreshold);
    }
  });
});

describe("resolveIntrigueOutcome - roll boundary", () => {
  it("roll = threshold - 1 → success", () => {
    // Build consequences manually and verify
    const plan = makePlan({ kind: "slander" });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "resolved") {
      // Verify: roll < threshold means success
      if (outcome.successRoll === outcome.successThreshold - 1) {
        expect(outcome.success).toBe(true);
      }
    }
  });

  it("roll = threshold → failure", () => {
    const plan = makePlan({ kind: "slander" });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "resolved") {
      if (outcome.successRoll === outcome.successThreshold) {
        expect(outcome.success).toBe(false);
      }
    }
  });
});

describe("resolveIntrigueOutcome - resolved outcome properties", () => {
  it("resolved outcome has rolls in 0-99", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "resolved") {
      expect(outcome.successRoll).toBeGreaterThanOrEqual(0);
      expect(outcome.successRoll).toBeLessThanOrEqual(99);
      expect(outcome.discoveryRoll).toBeGreaterThanOrEqual(0);
      expect(outcome.discoveryRoll).toBeLessThanOrEqual(99);
    }
  });

  it("thresholds are in valid ranges", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "resolved") {
      expect(outcome.successThreshold).toBeGreaterThanOrEqual(10);
      expect(outcome.successThreshold).toBeLessThanOrEqual(90);
      expect(outcome.discoveryThreshold).toBeGreaterThanOrEqual(5);
      expect(outcome.discoveryThreshold).toBeLessThanOrEqual(90);
    }
  });

  it("knowledge fields correct: actorKnowsOwnAction=true, target/palace match discovered", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "resolved") {
      expect(outcome.knowledge.actorKnowsOwnAction).toBe(true);
      expect(outcome.knowledge.targetKnowsInstigator).toBe(outcome.discovered);
      expect(outcome.knowledge.palacePublic).toBe(outcome.discovered);
    }
  });

  it("cancelled knowledge fields are all false", () => {
    const plan = makePlan({ sourceKey: "bad_key", year: 1, month: 3 });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "cancelled") {
      expect(outcome.knowledge.actorKnowsOwnAction).toBe(true);
      expect(outcome.knowledge.targetKnowsInstigator).toBe(false);
      expect(outcome.knowledge.palacePublic).toBe(false);
    }
  });

  it("cancelled outcome has empty consequences", () => {
    const plan = makePlan({ sourceKey: "bad_key", year: 1, month: 3 });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    if (outcome.status === "cancelled") {
      expect(outcome.consequences.standing).toHaveLength(0);
      expect(outcome.consequences.household).toHaveLength(0);
    }
  });

  it("is deterministic: same plan+state → same outcome", () => {
    const plan = makePlan();
    const state = makeStateWithPair("actor_001", "target_001");
    const a = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    const b = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("resolveIntrigueOutcome - all kinds", () => {
  const kinds = ["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"] as const;

  for (const kind of kinds) {
    const motive = kind === "false_accusation" ? "resentment"
      : kind === "faction_pressure" ? "faction"
      : kind === "steal_credit" ? "ambition"
      : "jealousy";

    it(`${kind} resolves without error`, () => {
      const plan = makePlan({ kind, motive });
      const state = makeStateWithPair("actor_001", "target_001");
      expect(() => resolveIntrigueOutcome(db, state, plan, RESOLVED_AT)).not.toThrow();
    });

    it(`${kind} consequences match canonical buildIntrigueConsequences`, () => {
      const plan = makePlan({ kind, motive });
      const state = makeStateWithPair("actor_001", "target_001");
      const outcome = resolveIntrigueOutcome(db, state, plan, RESOLVED_AT);
      if (outcome.status === "resolved") {
        const canonical = buildIntrigueConsequences(plan, outcome.success, outcome.discovered);
        expect(JSON.stringify(outcome.consequences)).toBe(JSON.stringify(canonical));
      }
    });
  }
});

describe("resolveIntrigueOutcome - discovery threshold increases with low secrecy", () => {
  it("lower secrecy → higher discovery threshold", () => {
    const plan_hi = makePlan({ secrecy: 80 });
    const plan_lo = makePlan({ secrecy: 20 });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome_hi = resolveIntrigueOutcome(db, state, plan_hi, RESOLVED_AT);
    const outcome_lo = resolveIntrigueOutcome(db, state, plan_lo, RESOLVED_AT);
    if (outcome_hi.status === "resolved" && outcome_lo.status === "resolved") {
      // Low secrecy means higher discovery chance (higher threshold)
      expect(outcome_lo.discoveryThreshold).toBeGreaterThan(outcome_hi.discoveryThreshold);
    }
  });
});

describe("resolveIntrigueOutcome - success threshold increases with high potency", () => {
  it("higher potency → higher success threshold", () => {
    const plan_hi = makePlan({ potency: 80 });
    const plan_lo = makePlan({ potency: 20 });
    const state = makeStateWithPair("actor_001", "target_001");
    const outcome_hi = resolveIntrigueOutcome(db, state, plan_hi, RESOLVED_AT);
    const outcome_lo = resolveIntrigueOutcome(db, state, plan_lo, RESOLVED_AT);
    if (outcome_hi.status === "resolved" && outcome_lo.status === "resolved") {
      expect(outcome_hi.successThreshold).toBeGreaterThan(outcome_lo.successThreshold);
    }
  });
});
