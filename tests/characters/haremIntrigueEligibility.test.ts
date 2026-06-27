import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import {
  runtimeConsortIds,
  checkIntrigueActorEligibility,
  checkIntrigueTargetEligibility,
} from "../../src/engine/characters/haremIntrigue/eligibility";
import type { GameState } from "../../src/engine/state/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";

const db = loadRealContent();
const base = createNewGameState(db);
const AT: GameTime = makeGameTime(1, 3, "early");

// Helper: find consort IDs that are in bedchamber (have harem standing)
function consortIds(): string[] {
  return Object.keys(base.bedchamber).sort();
}

describe("runtimeConsortIds", () => {
  it("returns sorted, deduplicated IDs from bedchamber", () => {
    const ids = runtimeConsortIds(base);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes authored consorts with bedchamber entries", () => {
    const ids = runtimeConsortIds(base);
    // shen_zhibai (huanghou) and lu_huaijin and xu_qinghuan are consorts
    const consortsInContent = ["shen_zhibai", "lu_huaijin", "xu_qinghuan", "wenya"];
    for (const id of consortsInContent) {
      if (db.characters[id]) {
        expect(ids).toContain(id);
      }
    }
  });

  it("excludes officials (not in bedchamber)", () => {
    const ids = runtimeConsortIds(base);
    expect(ids).not.toContain("wei_sui");
    expect(ids).not.toContain("cheng_feng");
  });

  it("excludes ghost IDs (no standing, no bedchamber)", () => {
    const ids = runtimeConsortIds(base);
    expect(ids).not.toContain("ghost_nonexistent");
  });

  it("is deterministic: same state → same result", () => {
    const a = runtimeConsortIds(base);
    const b = runtimeConsortIds(base);
    expect(a).toEqual(b);
  });

  it("generated consort in bedchamber is included", () => {
    const genId = "gen_consort_001";
    const state: GameState = {
      ...base,
      bedchamber: { ...base.bedchamber, [genId]: { encounters: [] } },
      standing: {
        ...base.standing,
        [genId]: { rank: "meiren", favor: 10, peakFavor: 10 },
      },
    };
    const ids = runtimeConsortIds(state);
    expect(ids).toContain(genId);
  });
});

// Shared actor for tests
function baseActorId(): string {
  // Find any active eligible consort (not huanghou to allow rivalry tests)
  const ids = consortIds();
  const nonEmpress = ids.find((id) => {
    const st = base.standing[id];
    return st && st.rank !== "huanghou";
  });
  return nonEmpress ?? ids[0]!;
}

function empresaId(): string {
  return "shen_zhibai";
}

describe("checkIntrigueActorEligibility - active passes", () => {
  it("active eligible actor passes", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const result = checkIntrigueActorEligibility(db, base, actorId, AT);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

describe("checkIntrigueActorEligibility - candidate fails", () => {
  it("candidate lifecycle fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, lifecycle: "candidate" },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("is_candidate");
  });
});

describe("checkIntrigueActorEligibility - deceased fails", () => {
  it("deceased lifecycle fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, lifecycle: "deceased" },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("is_deceased");
  });
});

describe("checkIntrigueActorEligibility - cold palace fails", () => {
  it("actor in cold palace fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${actorId}_000001`,
          kind: "cold_palace",
          characterId: actorId,
          startTurn: 0,
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("in_cold_palace");
  });
});

describe("checkIntrigueActorEligibility - confinement fails", () => {
  it("actor confined fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${actorId}_000001`,
          kind: "confinement",
          characterId: actorId,
          startTurn: 0,
          endTurnExclusive: null,
          imposedAt: AT,
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("in_confinement");
  });
});

// ── P2 fix: confinement uses at.dayIndex, not state.calendar ─────────────────
// AT = makeGameTime(1, 3, "early") → dayIndex = 6
// isConfinementActiveAt: active when turn >= startTurn && (end===null || turn < end)
// so endTurnExclusive=6 means: at turn 5 → confined; at turn 6 → free (expired)

describe("checkIntrigueActorEligibility - confinement boundary (at.dayIndex)", () => {
  it("actor confined at turn=5 (end=6): confined at AT.dayIndex-1 (turn 5)", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // endTurnExclusive=6 means confined until turn < 6, so turn 5 is still confined
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${actorId}_000001`,
          kind: "confinement",
          characterId: actorId,
          startTurn: 0,
          endTurnExclusive: 6, // exclusive end = AT.dayIndex
          imposedAt: AT,
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    // AT_PREV = makeGameTime(1, 2, "late") → dayIndex 5
    const AT_PREV = makeGameTime(1, 2, "late");
    const result = checkIntrigueActorEligibility(db, state, actorId, AT_PREV);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("in_confinement");
  });

  it("actor confinement just expired at AT.dayIndex=6 (endTurnExclusive=6): free", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // endTurnExclusive=6 means: turn 6 is NOT confined (exclusive boundary)
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${actorId}_000001`,
          kind: "confinement",
          characterId: actorId,
          startTurn: 0,
          endTurnExclusive: 6, // AT.dayIndex = 6 → not confined anymore
          imposedAt: makeGameTime(1, 1, "early"),
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    // AT.dayIndex (6) is NOT < endTurnExclusive (6), so confinement expired → eligible
    expect(result.reasons).not.toContain("in_confinement");
  });

  it("actor confinement expires next month (endTurnExclusive=9): still confined at AT", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // endTurnExclusive=9 → turn 6 (AT) < 9 → still confined
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${actorId}_000001`,
          kind: "confinement",
          characterId: actorId,
          startTurn: 0,
          endTurnExclusive: 9, // expires at year=1, month=4
          imposedAt: makeGameTime(1, 1, "early"),
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("in_confinement");
  });

  it("planner uses planning-time at: actor confined now but free next month is included in next-month plan", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // endTurnExclusive=9 → turn 9 = makeGameTime(1,4,"early") = free from month 4
    // AT = month 3 (turn 6) → confined; AT_NEXT = month 4 (turn 9) → free
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${actorId}_000001`,
          kind: "confinement",
          characterId: actorId,
          startTurn: 0,
          endTurnExclusive: 9, // expires at turn 9 = month 4 early
          imposedAt: makeGameTime(1, 1, "early"),
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    // At current AT (month 3, turn 6) → actor is confined
    const resultNow = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(resultNow.reasons).toContain("in_confinement");

    // At next month AT (month 4, turn 9) → confinement expired → actor eligible (for confinement check)
    const AT_NEXT = makeGameTime(1, 4, "early");
    const resultNext = checkIntrigueActorEligibility(db, state, actorId, AT_NEXT);
    expect(resultNext.reasons).not.toContain("in_confinement");
  });
});

describe("checkIntrigueTargetEligibility - confinement boundary (at.dayIndex)", () => {
  it("target confinement just expired at AT.dayIndex (endTurnExclusive=6): target is free", () => {
    const ids = consortIds();
    if (ids.length < 1) return;
    const targetId = ids[0]!;
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${targetId}_000001`,
          kind: "confinement",
          characterId: targetId,
          startTurn: 0,
          endTurnExclusive: 6, // AT.dayIndex = 6 → expired
          imposedAt: makeGameTime(1, 1, "early"),
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueTargetEligibility(db, state, targetId, AT);
    expect(result.reasons).not.toContain("in_confinement");
  });

  it("target still confined at AT (endTurnExclusive=7): not eligible", () => {
    const ids = consortIds();
    if (ids.length < 1) return;
    const targetId = ids[0]!;
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${targetId}_000001`,
          kind: "confinement",
          characterId: targetId,
          startTurn: 0,
          endTurnExclusive: 7, // AT.dayIndex=6 < 7 → still confined
          imposedAt: makeGameTime(1, 1, "early"),
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueTargetEligibility(db, state, targetId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("in_confinement");
  });

  it("target confined now but free next month: planning for next month excludes confinement", () => {
    const ids = consortIds();
    if (ids.length < 1) return;
    const targetId = ids[0]!;
    // endTurnExclusive=9 = makeGameTime(1,4,"early") → free from month 4
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${targetId}_000001`,
          kind: "confinement",
          characterId: targetId,
          startTurn: 0,
          endTurnExclusive: 9,
          imposedAt: makeGameTime(1, 1, "early"),
          imposedBy: "emperor",
        } as GameState["statusEffects"][number],
      ],
    };
    // At AT (turn 6): confined
    const resultNow = checkIntrigueTargetEligibility(db, state, targetId, AT);
    expect(resultNow.reasons).toContain("in_confinement");

    // At next month (turn 9): free
    const AT_NEXT = makeGameTime(1, 4, "early");
    const resultNext = checkIntrigueTargetEligibility(db, state, targetId, AT_NEXT);
    expect(resultNext.reasons).not.toContain("in_confinement");
  });
});

describe("checkIntrigueActorEligibility - critical health fails", () => {
  it("critical health fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, healthStatus: "critical" },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("critical_health");
  });
});

describe("checkIntrigueActorEligibility - carrying fails", () => {
  it("actor carrying (in gestation) fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      resources: {
        ...base.resources,
        bloodline: {
          ...base.resources.bloodline,
          gestations: [
            {
              carrier: actorId,
              conceivedAt: AT,
            },
          ],
        },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("is_carrying");
  });
});

describe("checkIntrigueActorEligibility - postpartum fails", () => {
  it("actor in postpartum recovery fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // AT is year=1, month=3, monthOrdinal = (1-1)*12+3 = 3
    // recoverUntilMonth=20 means still recovering (3 <= 20)
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, recoverUntilMonth: 20 },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("is_postpartum");
  });

  it("actor whose recovery ended is eligible (recoverUntilMonth < currentMonth)", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // AT = year:1, month:3, monthOrdinal = (1-1)*12 + 3 = 3
    // recoverUntilMonth: 1 means recovery already done (1 < 3)
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, recoverUntilMonth: 1 },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    // Should pass (recovery ended)
    expect(result.reasons).not.toContain("is_postpartum");
  });

  // P2-A: strict < boundary test — currentOrdinal === recoverUntilMonth means ELIGIBLE
  it("P2-A: actor is eligible when currentOrdinal === recoverUntilMonth (strict <, not <=)", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // AT = year:1, month:3 → currentOrdinal = (1-1)*12 + 3 = 3
    // recoverUntilMonth = 3 → currentOrdinal (3) < 3 is FALSE → eligible (not postpartum)
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, recoverUntilMonth: 3 },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.reasons).not.toContain("is_postpartum");
  });

  it("P2-A: actor is NOT eligible when currentOrdinal < recoverUntilMonth", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // AT = year:1, month:3 → currentOrdinal = 3
    // recoverUntilMonth = 4 → 3 < 4 is TRUE → not eligible
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, recoverUntilMonth: 4 },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("is_postpartum");
  });
});

describe("checkIntrigueActorEligibility - non-harem rank fails", () => {
  it("actor with official rank fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, rank: "sili_zhang" },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("non_harem_rank");
  });
});

describe("checkIntrigueActorEligibility - invalid rank fails", () => {
  it("actor with unknown rank fails", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [actorId]: { ...base.standing[actorId]!, rank: "nonexistent_rank_xyz" },
      },
    };
    const result = checkIntrigueActorEligibility(db, state, actorId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("invalid_rank");
  });
});

describe("checkIntrigueActorEligibility - not in bedchamber fails", () => {
  it("ID not in bedchamber fails", () => {
    const result = checkIntrigueActorEligibility(db, base, "wei_sui", AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("not_in_bedchamber");
  });
});

describe("checkIntrigueTargetEligibility - carrying ALLOWED", () => {
  it("target carrying is eligible (non-physical scheme)", () => {
    const ids = consortIds();
    if (ids.length < 2) return;
    const targetId = ids.find((id) => id !== baseActorId()) ?? ids[1]!;
    const state: GameState = {
      ...base,
      resources: {
        ...base.resources,
        bloodline: {
          ...base.resources.bloodline,
          gestations: [{ carrier: targetId, conceivedAt: AT }],
        },
      },
    };
    const result = checkIntrigueTargetEligibility(db, state, targetId, AT);
    // carrying should NOT be in reasons for target
    expect(result.reasons).not.toContain("is_carrying");
  });
});

describe("checkIntrigueTargetEligibility - postpartum ALLOWED", () => {
  it("target in postpartum recovery is eligible", () => {
    const ids = consortIds();
    if (ids.length < 1) return;
    const targetId = ids[0]!;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [targetId]: { ...base.standing[targetId]!, recoverUntilMonth: 999 },
      },
    };
    const result = checkIntrigueTargetEligibility(db, state, targetId, AT);
    expect(result.reasons).not.toContain("is_postpartum");
  });
});

describe("checkIntrigueTargetEligibility - empress target allowed", () => {
  it("empress can be a target (high rank)", () => {
    const targetId = empresaId();
    if (!base.standing[targetId]) return;
    const result = checkIntrigueTargetEligibility(db, base, targetId, AT);
    // Empress has harem rank, so she should be eligible as target
    expect(result.reasons).not.toContain("non_harem_rank");
    expect(result.reasons).not.toContain("invalid_rank");
  });
});

describe("checkIntrigueTargetEligibility - basic failures", () => {
  it("target deceased fails", () => {
    const ids = consortIds();
    if (ids.length < 1) return;
    const targetId = ids[0]!;
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        [targetId]: { ...base.standing[targetId]!, lifecycle: "deceased" },
      },
    };
    const result = checkIntrigueTargetEligibility(db, state, targetId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("is_deceased");
  });

  it("target in cold palace fails", () => {
    const ids = consortIds();
    if (ids.length < 1) return;
    const targetId = ids[0]!;
    const state: GameState = {
      ...base,
      statusEffects: [
        {
          id: `status_${targetId}_000001`,
          kind: "cold_palace",
          characterId: targetId,
          startTurn: 0,
        } as GameState["statusEffects"][number],
      ],
    };
    const result = checkIntrigueTargetEligibility(db, state, targetId, AT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("in_cold_palace");
  });
});

describe("self-target check (separate from eligibility functions)", () => {
  it("self-target is not filtered by individual eligibility checks", () => {
    const actorId = baseActorId();
    if (!actorId) return;
    // Both actor and target eligibility could pass for the same ID;
    // self-target prevention is in the planner/outcome layer
    const actorResult = checkIntrigueActorEligibility(db, base, actorId, AT);
    const targetResult = checkIntrigueTargetEligibility(db, base, actorId, AT);
    // They may both pass eligibility individually - self-check is at pair level
    expect(actorResult.reasons).not.toContain("is_self");
    expect(targetResult.reasons).not.toContain("is_self");
  });
});
