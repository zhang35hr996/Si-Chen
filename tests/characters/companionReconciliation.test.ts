import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { FamilyMember, GameState, Heir, OfficialFamily, RoyalRelative } from "../../src/engine/state/types";
import {
  applyCompanionReconciliation,
  buildRoyalFallbackCompanion,
  computePatronage,
  deriveFamilyYouthProfile,
  planCompanionReconciliation,
} from "../../src/engine/characters/companionReconciliation";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const NOW = makeGameTime(6, 1, "early");

const defaultPersonality = {
  empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50,
};

function makeHeir(id: string, birthYear: number, over: Partial<Heir> = {}): Heir {
  return {
    id, sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(birthYear, 1, "early"),
    favor: 50, legitimate: true, petName: "",
    education: { scholarship: 30, martial: 25, virtue: 28 },
    health: 70, talent: 50, diligence: 50,
    personality: defaultPersonality,
    interests: [], imperialFear: 20, neglect: 20, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
    ...over,
  };
}

function makeMember(id: string, familyId: string, age: number, over: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id, familyId, name: `成员${id}`, surname: "张", sex: "female", age, role: "daughter", ...over,
  };
}

function makeFamily(id: string, influence = 50, imperialFavor = 50): OfficialFamily {
  return { id, surname: "张", influence, imperialFavor };
}

function makeState(heirs: Heir[] = [], members: FamilyMember[] = [], families: OfficialFamily[] = []): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs = heirs;
  // Clear world data to make tests hermetic
  s.familyMembers = {};
  s.officialFamilies = {};
  s.officials = {};
  for (const m of members) s.familyMembers[m.id] = m;
  for (const f of families) s.officialFamilies[f.id] = f;
  s.calendar = { ...s.calendar, year: 6 }; // daughter age=5 enrolled at year=6
  return s;
}

// ── deriveFamilyYouthProfile ──────────────────────────────────────────────────

describe("deriveFamilyYouthProfile", () => {
  it("is deterministic for same seed+member", () => {
    const member = makeMember("m1", "fam1", 6);
    const p1 = deriveFamilyYouthProfile(42, member);
    const p2 = deriveFamilyYouthProfile(42, member);
    expect(p1.legitimate).toBe(p2.legitimate);
    expect(p1.personality).toEqual(p2.personality);
  });

  it("differs for different seeds", () => {
    const member = makeMember("m1", "fam1", 6);
    const p1 = deriveFamilyYouthProfile(1, member);
    const p2 = deriveFamilyYouthProfile(99999, member);
    // personalities won't be identical for different seeds (overwhelmingly likely)
    expect(JSON.stringify(p1.personality)).not.toBe(JSON.stringify(p2.personality));
  });

  it("personality traits are all 0–100", () => {
    const member = makeMember("m1", "fam1", 6);
    const { personality } = deriveFamilyYouthProfile(1234, member);
    for (const v of Object.values(personality)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

// ── computePatronage ──────────────────────────────────────────────────────────

describe("computePatronage", () => {
  it("returns 0 for unknown heir", () => {
    expect(computePatronage(makeState(), "ghost")).toBe(0);
  });

  it("legitimate heir with no custodian still scores from heir.favor", () => {
    const heir = makeHeir("h1", 1, { favor: 80, legitimate: true });
    const s = makeState([heir]);
    const score = computePatronage(s, "h1");
    expect(score).toBeGreaterThan(0);
  });

  it("illegitimate heir scores lower than legitimate with same favor", () => {
    const legit = makeHeir("h1", 1, { favor: 60, legitimate: true });
    const illegit = makeHeir("h2", 1, { favor: 60, legitimate: false });
    const s = makeState([legit, illegit]);
    expect(computePatronage(s, "h1")).toBeGreaterThan(computePatronage(s, "h2"));
  });
});

// ── planCompanionReconciliation ───────────────────────────────────────────────

describe("planCompanionReconciliation — eligibility", () => {
  it("assigns no companion if no students", () => {
    const s = makeState();
    const plan = planCompanionReconciliation(s, NOW);
    expect(plan.newAssignments).toHaveLength(0);
  });

  it("assigns no companion if no eligible family members and falls back to royal", () => {
    const heir = makeHeir("h1", 1); // age=5 at year=6, enrolled
    const s = makeState([heir]);
    const plan = planCompanionReconciliation(s, NOW);
    // no family members → royal fallback
    expect(plan.newAssignments).toHaveLength(1);
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
    expect(plan.newRoyalRelatives).toHaveLength(1);
  });

  it("skips heir already with active companion", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.heirCompanions["h1"] = {
      heirId: "h1",
      companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: NOW,
      status: "active",
      bond: 5,
      profile: { name: "已有伴读", sex: "female", age: 5, legitimate: true, personality: defaultPersonality },
    };
    const plan = planCompanionReconciliation(s, NOW);
    expect(plan.newAssignments).toHaveLength(0);
  });

  it("assigns family member when eligible", () => {
    const heir = makeHeir("h1", 1); // enrolled
    const member = makeMember("m1", "fam1", 5);
    const family = makeFamily("fam1");
    const s = makeState([heir], [member], [family]);
    const plan = planCompanionReconciliation(s, NOW);
    expect(plan.newAssignments).toHaveLength(1);
    expect(plan.newAssignments[0]!.companion.kind).toBe("family_member");
    expect(plan.newAssignments[0]!.companion.personId).toBe("m1");
  });

  it("excludes deceased family member", () => {
    const heir = makeHeir("h1", 1);
    const member = makeMember("m1", "fam1", 5, { deceasedAt: NOW });
    const family = makeFamily("fam1");
    const s = makeState([heir], [member], [family]);
    const plan = planCompanionReconciliation(s, NOW);
    // deceased → royal fallback
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
  });

  it("excludes too-old family member (age diff > 5)", () => {
    const heir = makeHeir("h1", 1); // age=5
    const member = makeMember("m1", "fam1", 11); // diff=6 > 5
    const family = makeFamily("fam1");
    const s = makeState([heir], [member], [family]);
    const plan = planCompanionReconciliation(s, NOW);
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
  });

  it("does not assign same family member to two heirs", () => {
    const h1 = makeHeir("h1", 1);
    const h2 = makeHeir("h2", 1, { id: "h2" });
    const member = makeMember("m1", "fam1", 5); // only one eligible
    const family = makeFamily("fam1");
    const s = makeState([h1, h2], [member], [family]);
    const plan = planCompanionReconciliation(s, NOW);
    const kinds = plan.newAssignments.map((a) => a.companion.kind);
    // one gets family_member, the other royal fallback
    expect(kinds).toContain("family_member");
    expect(kinds).toContain("royal_relative");
  });
});

describe("planCompanionReconciliation — ended companions", () => {
  it("ends active companion when heir leaves school (son turns 18)", () => {
    // son born year=1, at year=19 age=18 → not a student anymore
    const son = makeHeir("h1", 1, { sex: "son" });
    const s = makeState([son]);
    s.calendar = { ...s.calendar, year: 19 }; // son is 18, no longer student
    s.heirCompanions["h1"] = {
      heirId: "h1",
      companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: makeGameTime(8, 1, "early"),
      status: "active",
      bond: 10,
      profile: { name: "旧伴读", sex: "male", age: 10, legitimate: true, personality: defaultPersonality },
    };
    const now19 = makeGameTime(19, 1, "early");
    const plan = planCompanionReconciliation(s, now19);
    expect(plan.endedHeirIds).toContain("h1");
  });
});

describe("planCompanionReconciliation — multi-heir ordering", () => {
  it("assigns family member to higher-patronage heir first", () => {
    // h1 has custodian with high merit → higher patronage
    const h1 = makeHeir("h1", 1, { legitimate: true, favor: 90 });
    const h2 = makeHeir("h2", 1, { legitimate: false, favor: 10 });
    const member = makeMember("m1", "fam1", 5);
    const family = makeFamily("fam1");
    const s = makeState([h1, h2], [member], [family]);
    const plan = planCompanionReconciliation(s, NOW);
    const famAssignment = plan.newAssignments.find((a) => a.companion.kind === "family_member");
    expect(famAssignment?.heirId).toBe("h1");
  });
});

describe("planCompanionReconciliation — idempotency", () => {
  it("applying same plan twice does not add duplicate appointments", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    const plan = planCompanionReconciliation(s, NOW);

    // Apply once
    const s2 = { ...s };
    applyCompanionReconciliation(s2, plan, NOW);

    // Plan again after applying — should skip already-assigned heir
    const plan2 = planCompanionReconciliation(s2, NOW);
    expect(plan2.newAssignments).toHaveLength(0);
  });
});

// ── applyCompanionReconciliation ──────────────────────────────────────────────

describe("applyCompanionReconciliation", () => {
  it("writes new assignment into heirCompanions", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    const plan = planCompanionReconciliation(s, NOW);
    applyCompanionReconciliation(s, plan, NOW);
    expect(s.heirCompanions["h1"]).toBeDefined();
    expect(s.heirCompanions["h1"]!.status).toBe("active");
  });

  it("writes pending appointment notification", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    const plan = planCompanionReconciliation(s, NOW);
    applyCompanionReconciliation(s, plan, NOW);
    expect(s.pendingCompanionAppointments.length).toBe(1);
    expect(s.pendingCompanionAppointments[0]!.heirId).toBe("h1");
    expect(s.pendingCompanionAppointments[0]!.acknowledged).toBe(false);
  });

  it("ends companion and sets endedAt", () => {
    const son = makeHeir("h1", 1, { sex: "son" });
    const s = makeState([son]);
    s.calendar = { ...s.calendar, year: 19 };
    s.heirCompanions["h1"] = {
      heirId: "h1",
      companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: makeGameTime(8, 1, "early"),
      status: "active",
      bond: 5,
      profile: { name: "旧伴读", sex: "male", age: 10, legitimate: true, personality: defaultPersonality },
    };
    const now19 = makeGameTime(19, 1, "early");
    const plan = planCompanionReconciliation(s, now19);
    applyCompanionReconciliation(s, plan, now19);
    expect(s.heirCompanions["h1"]!.status).toBe("ended");
    expect(s.heirCompanions["h1"]!.endReason).toBe("heir_left_school");
    expect(s.heirCompanions["h1"]!.endedAt).toEqual(now19);
  });
});

// ── buildRoyalFallbackCompanion ───────────────────────────────────────────────

describe("buildRoyalFallbackCompanion", () => {
  it("returns a valid RoyalRelative", () => {
    const s = makeState();
    const relative = buildRoyalFallbackCompanion(s, "h1", 5, NOW);
    expect(relative.id).toBe(`royal_youth_h1_${NOW.year}`);
    expect(relative.lifecycle).toBe("alive");
    expect(relative.age).toBeGreaterThanOrEqual(0);
    expect(["close", "collateral", "distant"]).toContain(relative.branch);
    expect(relative.branchPrestige).toBeGreaterThanOrEqual(20);
    expect(relative.branchPrestige).toBeLessThanOrEqual(70);
  });

  it("is deterministic", () => {
    const s = makeState();
    const r1 = buildRoyalFallbackCompanion(s, "h1", 5, NOW);
    const r2 = buildRoyalFallbackCompanion(s, "h1", 5, NOW);
    expect(r1).toEqual(r2);
  });

  it("reuses existing royalRelative if present", () => {
    const s = makeState();
    const existing: RoyalRelative = {
      id: `royal_youth_h1_${NOW.year}`,
      name: "已有宗室", sex: "female", age: 5,
      branch: "close", branchPrestige: 60, legitimate: true,
      personality: defaultPersonality, lifecycle: "alive",
    };
    s.royalRelatives[existing.id] = existing;
    const result = buildRoyalFallbackCompanion(s, "h1", 5, NOW);
    expect(result).toBe(existing);
  });
});
