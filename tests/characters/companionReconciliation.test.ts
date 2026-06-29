import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { FamilyMember, GameState, Heir, OfficialFamily, RoyalRelative } from "../../src/engine/state/types";
import {
  applyCompanionReconciliation,
  buildRoyalFallbackCompanion,
  companionSexForHeir,
  computePatronage,
  deriveFamilyYouthProfile,
  planCompanionReconciliation,
  resolveCompanionView,
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
  s.standing = {};
  s.royalRelatives = {};
  s.heirCompanions = {};
  for (const m of members) s.familyMembers[m.id] = m;
  for (const f of families) s.officialFamilies[f.id] = f;
  s.calendar = { ...s.calendar, year: 6 }; // daughter age=5 enrolled at year=6
  return s;
}

// ── companionSexForHeir ───────────────────────────────────────────────────────

describe("companionSexForHeir", () => {
  it("皇子(daughter) → 女性伴读", () => {
    expect(companionSexForHeir(makeHeir("h", 1, { sex: "daughter" }))).toBe("female");
  });
  it("皇郎(son) → 男性伴读", () => {
    expect(companionSexForHeir(makeHeir("h", 1, { sex: "son" }))).toBe("male");
  });
});

// ── deriveFamilyYouthProfile ──────────────────────────────────────────────────

describe("deriveFamilyYouthProfile", () => {
  it("无正室(consort_in)家族 → 不可能嫡出", () => {
    const member = makeMember("m1", "fam1", 6);
    const s = makeState([], [member], [makeFamily("fam1")]);
    const p = deriveFamilyYouthProfile(s, member);
    expect(p.legitimate).toBe(false);
  });

  it("有正室时，同性别年长者(birthOrder 0) 必为嫡", () => {
    const elder = makeMember("m_elder", "fam1", 8);
    const younger = makeMember("m_younger", "fam1", 5);
    const consortIn = makeMember("m_zheng", "fam1", 40, { role: "consort_in", sex: "male" });
    const s = makeState([], [elder, younger, consortIn], [makeFamily("fam1")]);
    const pElder = deriveFamilyYouthProfile(s, elder);
    expect(pElder.birthOrder).toBe(0);
    expect(pElder.legitimate).toBe(true);
  });

  it("birthOrder 按同性别年龄降序", () => {
    const elder = makeMember("m_elder", "fam1", 8);
    const younger = makeMember("m_younger", "fam1", 5);
    const s = makeState([], [elder, younger], [makeFamily("fam1")]);
    expect(deriveFamilyYouthProfile(s, elder).birthOrder).toBe(0);
    expect(deriveFamilyYouthProfile(s, younger).birthOrder).toBe(1);
  });

  it("is deterministic", () => {
    const member = makeMember("m1", "fam1", 6);
    const s = makeState([], [member], [makeFamily("fam1")]);
    expect(deriveFamilyYouthProfile(s, member)).toEqual(deriveFamilyYouthProfile(s, member));
  });

  it("内卿去世不改变子女嫡庶/排行（出生身份）", () => {
    const child = makeMember("m_child", "fam1", 8);
    const consortIn = makeMember("m_zheng", "fam1", 40, { role: "consort_in", sex: "male" });
    const sAlive = makeState([], [child, consortIn], [makeFamily("fam1")]);
    const before = deriveFamilyYouthProfile(sAlive, child);

    const consortDead = { ...consortIn, deceasedAt: makeGameTime(5, 1, "early") };
    const sDead = makeState([], [child, consortDead], [makeFamily("fam1")]);
    const after = deriveFamilyYouthProfile(sDead, child);

    expect(after.legitimate).toBe(before.legitimate);
    expect(after.legitimate).toBe(true);
    expect(after.birthOrder).toBe(before.birthOrder);
  });
});

// ── computePatronage (养父=侍君) ──────────────────────────────────────────────

describe("computePatronage", () => {
  it("returns 0 for unknown heir", () => {
    expect(computePatronage(db, makeState(), "ghost")).toBe(0);
  });

  it("养父位分越高 → patronage 越高", () => {
    const lowRank = Object.values(db.ranks).filter((r) => r.domain === "harem").sort((a, b) => a.order - b.order)[0]!;
    const highRank = Object.values(db.ranks).filter((r) => r.domain === "harem" && r.id !== "huanghou").sort((a, b) => b.order - a.order)[0]!;

    const heir = makeHeir("h1", 1, { adoptiveFatherId: "cust1" });
    const sLow = makeState([heir]);
    sLow.standing["cust1"] = { rank: lowRank.id, favor: 50, peakFavor: 50 };
    const sHigh = makeState([heir]);
    sHigh.standing["cust1"] = { rank: highRank.id, favor: 50, peakFavor: 50 };

    expect(computePatronage(db, sHigh, "h1")).toBeGreaterThan(computePatronage(db, sLow, "h1"));
  });

  it("养父恩宠越高 → patronage 越高", () => {
    const rank = Object.values(db.ranks).find((r) => r.domain === "harem")!;
    const heir = makeHeir("h1", 1, { adoptiveFatherId: "cust1" });
    const sLow = makeState([heir]);
    sLow.standing["cust1"] = { rank: rank.id, favor: 10, peakFavor: 10 };
    const sHigh = makeState([heir]);
    sHigh.standing["cust1"] = { rank: rank.id, favor: 90, peakFavor: 90 };
    expect(computePatronage(db, sHigh, "h1")).toBeGreaterThan(computePatronage(db, sLow, "h1"));
  });

  it("养父母族 influence 越高 → patronage 越高", () => {
    const rank = Object.values(db.ranks).find((r) => r.domain === "harem")!;
    const heir = makeHeir("h1", 1, { adoptiveFatherId: "cust1" });
    const sLow = makeState([heir], [], [makeFamily("famA", 10)]);
    sLow.standing["cust1"] = { rank: rank.id, favor: 50, peakFavor: 50, birthFamilyId: "famA" };
    const sHigh = makeState([heir], [], [makeFamily("famA", 90)]);
    sHigh.standing["cust1"] = { rank: rank.id, favor: 50, peakFavor: 50, birthFamilyId: "famA" };
    expect(computePatronage(db, sHigh, "h1")).toBeGreaterThan(computePatronage(db, sLow, "h1"));
  });

  it("legitimate heir scores higher than illegitimate with same favor", () => {
    const legit = makeHeir("h1", 1, { favor: 60, legitimate: true });
    const illegit = makeHeir("h2", 1, { favor: 60, legitimate: false });
    const s = makeState([legit, illegit]);
    expect(computePatronage(db, s, "h1")).toBeGreaterThan(computePatronage(db, s, "h2"));
  });
});

// ── 同性别匹配 (阻塞1) ─────────────────────────────────────────────────────────

describe("planCompanionReconciliation — 同性别", () => {
  it("皇子只匹配女性家族子弟", () => {
    const daughterHeir = makeHeir("h1", 1, { sex: "daughter" });
    const maleMember = makeMember("m_male", "fam1", 5, { sex: "male", role: "son" });
    const s = makeState([daughterHeir], [maleMember], [makeFamily("fam1")]);
    const plan = planCompanionReconciliation(db, s, NOW);
    // 异性家族子弟被排除 → 宗室 fallback（女性）
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
    expect(plan.newAssignments[0]!.profile.sex).toBe("female");
  });

  it("皇郎只匹配男性家族子弟", () => {
    const sonHeir = makeHeir("h1", 1, { sex: "son" });
    sonHeir.portraitVariants = { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" };
    const femaleMember = makeMember("m_fem", "fam1", 9, { sex: "female", role: "daughter" });
    const maleMember = makeMember("m_male", "fam1", 9, { sex: "male", role: "son" });
    const s = makeState([sonHeir], [femaleMember, maleMember], [makeFamily("fam1")]);
    s.calendar = { ...s.calendar, year: 8 }; // son age=7 enrolled
    const now8 = makeGameTime(8, 1, "early");
    const plan = planCompanionReconciliation(db, s, now8);
    expect(plan.newAssignments[0]!.companion.kind).toBe("family_member");
    expect(plan.newAssignments[0]!.companion.personId).toBe("m_male");
  });

  it("异性候选即使家世最高也被排除", () => {
    const daughterHeir = makeHeir("h1", 1, { sex: "daughter" });
    // 极高家世男性候选
    const richMale = makeMember("m_rich", "famR", 5, { sex: "male", role: "son" });
    const s = makeState([daughterHeir], [richMale], [makeFamily("famR", 100, 100)]);
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
  });

  it("宗室 fallback 与皇嗣同性", () => {
    const sonHeir = makeHeir("h1", 1, { sex: "son" });
    sonHeir.portraitVariants = { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" };
    const s = makeState([sonHeir]);
    s.calendar = { ...s.calendar, year: 8 };
    const now8 = makeGameTime(8, 1, "early");
    const plan = planCompanionReconciliation(db, s, now8);
    expect(plan.newRoyalRelatives[0]!.sex).toBe("male");
  });
});

// ── 年龄分层 (阻塞4) ──────────────────────────────────────────────────────────

describe("planCompanionReconciliation — 年龄分层", () => {
  it("优先 ±2 内候选", () => {
    const heir = makeHeir("h1", 1); // age=5
    const close = makeMember("m_close", "fam1", 6); // diff=1
    const far = makeMember("m_far", "fam2", 8); // diff=3
    const s = makeState([heir], [close, far], [makeFamily("fam1"), makeFamily("fam2")]);
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.newAssignments[0]!.companion.personId).toBe("m_close");
  });

  it("无 ±2 候选时放宽到 ±3", () => {
    const heir = makeHeir("h1", 1); // age=5
    const mid = makeMember("m_mid", "fam1", 8); // diff=3
    const s = makeState([heir], [mid], [makeFamily("fam1")]);
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.newAssignments[0]!.companion.personId).toBe("m_mid");
  });

  it("不会选年龄差 4–5 的候选（落入宗室 fallback）", () => {
    const heir = makeHeir("h1", 1); // age=5
    const tooFar = makeMember("m_far", "fam1", 10); // diff=5
    const s = makeState([heir], [tooFar], [makeFamily("fam1")]);
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
  });
});

// ── patronage 驱动 (阻塞2/4) ──────────────────────────────────────────────────

describe("planCompanionReconciliation — patronage 驱动", () => {
  it("高 patronage 匹配更高 familyQuality 家族", () => {
    const rank = Object.values(db.ranks).filter((r) => r.domain === "harem").sort((a, b) => b.order - a.order)[1]!;
    const heir = makeHeir("h1", 1, { adoptiveFatherId: "cust1", favor: 90, legitimate: true });
    const richMember = makeMember("m_rich", "famHigh", 5);
    const poorMember = makeMember("m_poor", "famLow", 5);
    const s = makeState([heir], [richMember, poorMember], [makeFamily("famHigh", 95, 95), makeFamily("famLow", 10, 10)]);
    s.standing["cust1"] = { rank: rank.id, favor: 95, peakFavor: 95 };
    const plan = planCompanionReconciliation(db, s, NOW);
    // 高 patronage → 倾向高门
    expect(plan.newAssignments[0]!.companion.personId).toBe("m_rich");
  });

  it("高 patronage 宗室 fallback 获得近支(close)", () => {
    const rank = Object.values(db.ranks).filter((r) => r.domain === "harem" && r.id !== "huanghou").sort((a, b) => b.order - a.order)[0]!;
    const heir = makeHeir("h1", 1, { adoptiveFatherId: "cust1", favor: 100, legitimate: true });
    const s = makeState([heir], [], [makeFamily("famA", 100)]);
    s.standing["cust1"] = { rank: rank.id, favor: 100, peakFavor: 100, birthFamilyId: "famA" };
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.newRoyalRelatives[0]!.branch).toBe("close");
  });

  it("低 patronage 宗室 fallback 获得远支(distant)", () => {
    const heir = makeHeir("h1", 1, { favor: 5, legitimate: false }); // 无养父
    const s = makeState([heir]);
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.newRoyalRelatives[0]!.branch).toBe("distant");
  });
});

// ── 基础择定/幂等 ─────────────────────────────────────────────────────────────

describe("planCompanionReconciliation — 基础", () => {
  it("无学生不分配", () => {
    expect(planCompanionReconciliation(db, makeState(), NOW).newAssignments).toHaveLength(0);
  });

  it("无官员候选 → 宗室 fallback", () => {
    const plan = planCompanionReconciliation(db, makeState([makeHeir("h1", 1)]), NOW);
    expect(plan.newAssignments).toHaveLength(1);
    expect(plan.newAssignments[0]!.companion.kind).toBe("royal_relative");
    expect(plan.newRoyalRelatives).toHaveLength(1);
  });

  it("跳过已有 active 伴读的皇嗣", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: NOW, status: "active", bond: 5, ageAtAssignment: 5,
      profile: { name: "已有", sex: "female", legitimate: true, personality: defaultPersonality },
    };
    s.royalRelatives["r1"] = { id: "r1", name: "已有", sex: "female", age: 5, branch: "close", branchPrestige: 50, legitimate: true, personality: defaultPersonality, lifecycle: "alive" };
    expect(planCompanionReconciliation(db, s, NOW).newAssignments).toHaveLength(0);
  });

  it("不把同一家族子弟分给两名皇嗣", () => {
    const h1 = makeHeir("h1", 1);
    const h2 = makeHeir("h2", 1);
    const member = makeMember("m1", "fam1", 5);
    const s = makeState([h1, h2], [member], [makeFamily("fam1")]);
    const plan = planCompanionReconciliation(db, s, NOW);
    const kinds = plan.newAssignments.map((a) => a.companion.kind);
    expect(kinds).toContain("family_member");
    expect(kinds).toContain("royal_relative");
  });

  it("idempotent：apply 后再 plan 无新分配", () => {
    const s = makeState([makeHeir("h1", 1)]);
    const plan = planCompanionReconciliation(db, s, NOW);
    const s2 = applyCompanionReconciliation(s, plan, NOW);
    expect(planCompanionReconciliation(db, s2, NOW).newAssignments).toHaveLength(0);
  });
});

// ── 结束：离校 + 身故 + 替补 (阻塞7) ──────────────────────────────────────────

describe("planCompanionReconciliation — 结束", () => {
  it("皇嗣离校结束伴读(heir_left_school)", () => {
    const son = makeHeir("h1", 1, { sex: "son" });
    const s = makeState([son]);
    s.calendar = { ...s.calendar, year: 19 }; // son age=18 不再在读
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: makeGameTime(8, 1, "early"), status: "active", bond: 10, ageAtAssignment: 10,
      profile: { name: "旧", sex: "male", legitimate: true, personality: defaultPersonality },
    };
    const now19 = makeGameTime(19, 1, "early");
    const plan = planCompanionReconciliation(db, s, now19);
    expect(plan.endedAssignments).toContainEqual({ heirId: "h1", assignmentId: "companion_assignment_h1_0", reason: "heir_left_school" });
  });

  it("伴读身故结束(companion_deceased)并为在读皇嗣补选", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    // 伴读宗室已身故
    s.royalRelatives["r1"] = { id: "r1", name: "亡友", sex: "female", age: 6, branch: "close", branchPrestige: 50, legitimate: true, personality: defaultPersonality, lifecycle: "deceased", deceasedAt: NOW };
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: makeGameTime(5, 1, "early"), status: "active", bond: 8, ageAtAssignment: 5,
      profile: { name: "亡友", sex: "female", legitimate: true, personality: defaultPersonality },
    };
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(plan.endedAssignments).toContainEqual({ heirId: "h1", assignmentId: "companion_assignment_h1_0", reason: "companion_deceased" });
    // 替补：同次为在读皇嗣 h1 选了新伴读
    expect(plan.newAssignments.some((a) => a.heirId === "h1")).toBe(true);
  });

  it("同年身故的宗室 fallback 不被复用，替补为不同 personId 的活人且不再循环结束", () => {
    const heir = makeHeir("h1", 1); // age=5, year=6, no official candidates → 宗室 fallback
    // 第一次：生成本年宗室 fallback。
    const s0 = makeState([heir]);
    const plan0 = planCompanionReconciliation(db, s0, NOW);
    const first = plan0.newAssignments[0]!;
    expect(first.companion.kind).toBe("royal_relative");
    const firstId = first.companion.personId;
    expect(firstId).toBe(`royal_youth_h1_${NOW.year}`);
    const s1 = applyCompanionReconciliation(s0, plan0, NOW);

    // 该宗室伴读在同年身故。
    const dead = { ...s1.royalRelatives[firstId]!, lifecycle: "deceased" as const, deceasedAt: NOW };
    const s2 = { ...s1, royalRelatives: { ...s1.royalRelatives, [firstId]: dead } };

    // 第二次 reconciliation：结束身故 + 补选不同 personId 的活人。
    const plan1 = planCompanionReconciliation(db, s2, NOW);
    expect(plan1.endedAssignments.some((e) => e.heirId === "h1" && e.reason === "companion_deceased")).toBe(true);
    const replacement = plan1.newAssignments.find((a) => a.heirId === "h1")!;
    expect(replacement.companion.personId).not.toBe(firstId);
    const newRel = plan1.newRoyalRelatives.find((r) => r.id === replacement.companion.personId)!;
    expect(newRel.lifecycle).toBe("alive");
    const s3 = applyCompanionReconciliation(s2, plan1, NOW);

    // 第三次 reconciliation：活人替补已就位 → 不再结束、不再补选（无死循环）。
    const plan2 = planCompanionReconciliation(db, s3, NOW);
    expect(plan2.endedAssignments).toHaveLength(0);
    expect(plan2.newAssignments).toHaveLength(0);
  });
});

// ── applyCompanionReconciliation 不可变 (阻塞5) ───────────────────────────────

describe("applyCompanionReconciliation — 不可变", () => {
  it("不修改输入 state 及其嵌套集合", () => {
    const s = makeState([makeHeir("h1", 1)]);
    const beforeCompanions = s.heirCompanions;
    const beforeRoyals = s.royalRelatives;
    const plan = planCompanionReconciliation(db, s, NOW);
    const s2 = applyCompanionReconciliation(s, plan, NOW);
    // 输入引用不变
    expect(s.heirCompanions).toBe(beforeCompanions);
    expect(s.royalRelatives).toBe(beforeRoyals);
    expect(Object.keys(s.heirCompanions)).toHaveLength(0);
    // 新 state 引用变化
    expect(s2).not.toBe(s);
    expect(s2.heirCompanions).not.toBe(s.heirCompanions);
    expect(s2.royalRelatives).not.toBe(s.royalRelatives);
    expect(s2.heirCompanions["h1"]).toBeDefined();
  });

  it("空 plan 返回原 state 引用", () => {
    const s = makeState();
    const plan = planCompanionReconciliation(db, s, NOW);
    expect(applyCompanionReconciliation(s, plan, NOW)).toBe(s);
  });

  it("结束：从 active 移出并入历史（endedAt/endReason 齐全），active 不再保留该 heir", () => {
    const son = makeHeir("h1", 1, { sex: "son" });
    const s = makeState([son]);
    s.calendar = { ...s.calendar, year: 19 };
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: makeGameTime(8, 1, "early"), status: "active", bond: 5, ageAtAssignment: 10,
      profile: { name: "旧", sex: "male", legitimate: true, personality: defaultPersonality },
    };
    const now19 = makeGameTime(19, 1, "early");
    const plan = planCompanionReconciliation(db, s, now19);
    const s2 = applyCompanionReconciliation(s, plan, now19);
    // active map 中已无该皇嗣（离校后无替补）
    expect(s2.heirCompanions["h1"]).toBeUndefined();
    // 历史中保留该段关系，含 endedAt/endReason
    const hist = s2.endedCompanionAssignments.find((a) => a.id === "companion_assignment_h1_0")!;
    expect(hist).toBeDefined();
    expect(hist.status).toBe("ended");
    expect(hist.endReason).toBe("heir_left_school");
    expect(hist.endedAt).toEqual(now19);
  });
});

// ── buildRoyalFallbackCompanion ───────────────────────────────────────────────

describe("buildRoyalFallbackCompanion", () => {
  it("returns valid RoyalRelative with heir-matching sex", () => {
    const heir = makeHeir("h1", 1, { sex: "son" });
    const s = makeState();
    const rel = buildRoyalFallbackCompanion(s, heir, 7, 60, NOW);
    expect(rel.id).toBe(`royal_youth_h1_${NOW.year}`);
    expect(rel.sex).toBe("male");
    expect(rel.lifecycle).toBe("alive");
    expect(Math.abs(rel.age - 7)).toBeLessThanOrEqual(2); // 年龄相近 ±2
  });

  it("is deterministic", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState();
    expect(buildRoyalFallbackCompanion(s, heir, 5, 50, NOW)).toEqual(buildRoyalFallbackCompanion(s, heir, 5, 50, NOW));
  });

  it("reuses existing royalRelative", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState();
    const existing: RoyalRelative = {
      id: `royal_youth_h1_${NOW.year}`, name: "已有", sex: "female", age: 5,
      branch: "close", branchPrestige: 60, legitimate: true, personality: defaultPersonality, lifecycle: "alive",
    };
    s.royalRelatives[existing.id] = existing;
    expect(buildRoyalFallbackCompanion(s, heir, 5, 50, NOW)).toBe(existing);
  });
});

// ── resolveCompanionView — live age (阻塞8) ───────────────────────────────────

describe("resolveCompanionView", () => {
  it("年龄取 live 来源而非快照", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    // 家族成员现已 12 岁，但 assignment 入学时快照为 6
    s.familyMembers["m1"] = makeMember("m1", "fam1", 12);
    s.officialFamilies["fam1"] = makeFamily("fam1");
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "family_member", personId: "m1" },
      assignedAt: makeGameTime(2, 1, "early"), status: "active", bond: 3, ageAtAssignment: 6,
      profile: { name: "成员m1", sex: "female", legitimate: false, personality: defaultPersonality, familyName: "张", familyRole: "daughter" },
    };
    const view = resolveCompanionView(s, s.heirCompanions["h1"]!);
    expect(view.age).toBe(12); // live, not 6
    expect(view.source).toBe("family_member");
  });

  it("来源缺失时回退快照年龄", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "royal_relative", personId: "missing" },
      assignedAt: NOW, status: "active", bond: 0, ageAtAssignment: 5,
      profile: { name: "快照", sex: "female", legitimate: true, personality: defaultPersonality },
    };
    expect(resolveCompanionView(s, s.heirCompanions["h1"]!).age).toBe(5);
  });
});
