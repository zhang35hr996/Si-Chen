/** PR #130 review regression tests. */
import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadGameContent } from "../../src/engine/content/viteSource";
import {
  applyCompanionReconciliation,
  planCompanionReconciliation,
} from "../../src/engine/characters/companionReconciliation";
import { validateCompanionWorld } from "../../src/engine/characters/companionValidator";
import { createNewGameState } from "../../src/engine/state/newGame";
import type {
  GameState,
  Heir,
  HeirCompanionAssignment,
  RoyalRelative,
} from "../../src/engine/state/types";

const loaded = loadGameContent();
if (!loaded.ok) throw new Error("content failed to load");
const db = loaded.value;
const NOW = makeGameTime(6, 1, "early");
const personality = {
  empathy: 50,
  guile: 50,
  restraint: 50,
  sociability: 50,
  assertiveness: 50,
  curiosity: 50,
};

function heir(id = "h1"): Heir {
  return {
    id,
    sex: "daughter",
    fatherId: null,
    bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"),
    favor: 50,
    legitimate: true,
    petName: "",
    education: { scholarship: 30, martial: 25, virtue: 28 },
    health: 70,
    talent: 50,
    diligence: 50,
    personality,
    interests: [],
    imperialFear: 20,
    neglect: 20,
    custodianBond: 0,
    portraitVariants: {
      baby: "girl_baby1",
      kid: "girl_kid1",
      child: "girl_child1",
      teen: "girl_teen1",
    },
    ambition: 20,
    closeness: 50,
    support: 20,
    faction: "none",
    lifecycle: "alive",
  };
}

function stateWithHeir(): GameState {
  const state = createNewGameState(db);
  state.calendar = { ...state.calendar, year: 6 };
  state.resources.bloodline.heirs = [heir()];
  state.familyMembers = {};
  state.officialFamilies = {};
  state.officials = {};
  state.standing = {};
  state.royalRelatives = {};
  state.heirCompanions = {};
  state.endedCompanionAssignments = [];
  state.nextCompanionAssignmentSeq = 0;
  return state;
}

function royal(id: string, lifecycle: "alive" | "deceased" = "alive"): RoyalRelative {
  return {
    id,
    name: id,
    sex: "female",
    age: 6,
    branch: "close",
    branchPrestige: 50,
    legitimate: true,
    personality,
    lifecycle,
    deceasedAt: lifecycle === "deceased" ? NOW : undefined,
  };
}

function assignment(
  id = "companion_assignment_h1_0",
  personId = "r1",
): HeirCompanionAssignment {
  return {
    id,
    heirId: "h1",
    companion: { kind: "royal_relative", personId },
    assignedAt: makeGameTime(5, 1, "early"),
    status: "active",
    bond: 5,
    ageAtAssignment: 5,
    profile: {
      name: personId,
      sex: "female",
      legitimate: true,
      personality,
    },
  };
}

describe("companion history review fixes", () => {
  it("stale replacement plan cannot overwrite a newer active assignment", () => {
    const oldState = stateWithHeir();
    oldState.royalRelatives.r1 = royal("r1", "deceased");
    oldState.heirCompanions.h1 = assignment();
    oldState.nextCompanionAssignmentSeq = 1;
    const stalePlan = planCompanionReconciliation(db, oldState, NOW);

    const newer = assignment("companion_assignment_h1_9", "r2");
    const current: GameState = {
      ...oldState,
      royalRelatives: { ...oldState.royalRelatives, r2: royal("r2") },
      heirCompanions: { h1: newer },
      nextCompanionAssignmentSeq: 10,
    };

    const result = applyCompanionReconciliation(current, stalePlan, NOW);
    expect(result.heirCompanions.h1).toEqual(newer);
    expect(result.endedCompanionAssignments).toHaveLength(0);
    expect(result.nextCompanionAssignmentSeq).toBe(10);
  });

  it("apply skips occupied numeric ids when the counter is stale", () => {
    const state = stateWithHeir();
    state.royalRelatives.r1 = royal("r1", "deceased");
    state.heirCompanions.h1 = assignment();
    state.nextCompanionAssignmentSeq = 0;

    const plan = planCompanionReconciliation(db, state, NOW);
    const result = applyCompanionReconciliation(state, plan, NOW);
    const ids = [
      ...Object.values(result.heirCompanions).map((item) => item.id),
      ...result.endedCompanionAssignments.map((item) => item.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect(result.heirCompanions.h1?.id).toBe("companion_assignment_h1_1");
    expect(result.nextCompanionAssignmentSeq).toBe(2);
  });

  it("validator rejects a counter that does not lead existing numeric ids", () => {
    const state = stateWithHeir();
    state.royalRelatives.r1 = royal("r1");
    state.heirCompanions.h1 = assignment("companion_assignment_h1_7");
    state.nextCompanionAssignmentSeq = 3;

    expect(
      validateCompanionWorld(state).some(
        (error) => error.code === "COMPANION_SEQUENCE_NOT_AHEAD",
      ),
    ).toBe(true);
  });

  it("legacy ids do not participate in the numeric sequence invariant", () => {
    const state = stateWithHeir();
    state.royalRelatives.r1 = royal("r1");
    state.heirCompanions.h1 = assignment("companion_assignment_legacy_h1");
    state.nextCompanionAssignmentSeq = 0;

    expect(
      validateCompanionWorld(state).some(
        (error) => error.code === "COMPANION_SEQUENCE_NOT_AHEAD",
      ),
    ).toBe(false);
  });

  it("history rejects dangling heir and person references", () => {
    const base = stateWithHeir();
    base.royalRelatives.r1 = royal("r1", "deceased");
    const ended: HeirCompanionAssignment = {
      ...assignment(),
      status: "ended",
      endedAt: NOW,
      endReason: "companion_deceased",
    };

    const missingHeir = {
      ...base,
      endedCompanionAssignments: [{ ...ended, heirId: "ghost" }],
    };
    expect(
      validateCompanionWorld(missingHeir).some(
        (error) => error.code === "COMPANION_DANGLING_HEIR",
      ),
    ).toBe(true);

    const missingPerson: GameState = {
      ...base,
      endedCompanionAssignments: [
        {
          ...ended,
          companion: { kind: "royal_relative", personId: "ghost" },
        },
      ],
    };
    expect(
      validateCompanionWorld(missingPerson).some(
        (error) => error.code === "COMPANION_DANGLING_PERSON",
      ),
    ).toBe(true);
  });

  it("history checks snapshot sex and still accepts extant deceased people", () => {
    const base = stateWithHeir();
    base.royalRelatives.r1 = royal("r1", "deceased");
    const ended: HeirCompanionAssignment = {
      ...assignment(),
      status: "ended",
      endedAt: NOW,
      endReason: "companion_deceased",
    };
    base.endedCompanionAssignments = [ended];
    expect(validateCompanionWorld(base)).toHaveLength(0);

    const wrongProfile: GameState = {
      ...base,
      endedCompanionAssignments: [
        { ...ended, profile: { ...ended.profile, sex: "male" } },
      ],
    };
    expect(
      validateCompanionWorld(wrongProfile).some(
        (error) => error.code === "COMPANION_SEX_MISMATCH",
      ),
    ).toBe(true);
  });

  it("history accepts an extant deceased family member", () => {
    const state = stateWithHeir();
    state.familyMembers.fm1 = {
      id: "fm1",
      familyId: "family_1",
      name: "故友",
      surname: "林",
      sex: "female",
      age: 8,
      role: "daughter",
      deceasedAt: NOW,
    };
    state.endedCompanionAssignments = [
      {
        ...assignment("legacy_history", "fm1"),
        companion: { kind: "family_member", personId: "fm1" },
        status: "ended",
        endedAt: NOW,
        endReason: "companion_deceased",
      },
    ];

    expect(validateCompanionWorld(state)).toHaveLength(0);
  });
});
