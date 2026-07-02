/**
 * 伴读关系身份、历任历史与 selectors（PR4C-1）。
 * 覆盖：结束入历史、active-only、替补、幂等、ID 唯一、selectors、validator、不可变。
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir, HeirCompanionAssignment, RoyalRelative } from "../../src/engine/state/types";
import {
  applyCompanionReconciliation,
  getActiveCompanion,
  getCompanionAssignmentById,
  getFormerCompanions,
  planCompanionReconciliation,
  resolveCompanionView,
} from "../../src/engine/characters/companionReconciliation";
import { validateCompanionWorld } from "../../src/engine/characters/companionValidator";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const NOW = makeGameTime(6, 1, "early");
const defaultPersonality = { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 };

function makeHeir(id: string, birthYear: number, over: Partial<Heir> = {}): Heir {
  return {
    id, sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(birthYear, 1, "early"),
    favor: 50, legitimate: true, petName: "",
    education: { scholarship: 30, martial: 25, virtue: 28 },
    health: 70, talent: 50, diligence: 50, personality: defaultPersonality,
    interests: [], imperialFear: 20, neglect: 20, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive", ...over,
  };
}

function makeState(heirs: Heir[] = []): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs = heirs;
  s.familyMembers = {}; s.officialFamilies = {}; s.officials = {}; s.standing = {};
  s.royalRelatives = {}; s.heirCompanions = {}; s.endedCompanionAssignments = []; s.nextCompanionAssignmentSeq = 0;
  s.calendar = { ...s.calendar, year: 6 };
  return s;
}

/** Run plan+apply once; returns new state. */
function reconcile(s: GameState, now = NOW): GameState {
  return applyCompanionReconciliation(s, planCompanionReconciliation(db, s, now), now);
}

function activeAssignment(heirId: string): HeirCompanionAssignment {
  return {
    id: `companion_assignment_${heirId}_0`, heirId,
    companion: { kind: "royal_relative", personId: "r1" },
    assignedAt: makeGameTime(5, 1, "early"), status: "active", bond: 5, ageAtAssignment: 5,
    profile: { name: "亡友", sex: "female", legitimate: true, personality: defaultPersonality },
  };
}
function deadRoyal(): RoyalRelative {
  return { id: "r1", name: "亡友", sex: "female", age: 6, branch: "close", branchPrestige: 50, legitimate: true, personality: defaultPersonality, lifecycle: "deceased", deceasedAt: NOW };
}

// ── 1 & 3：死亡 → 旧入历史、新留 active（同一次 reconciliation） ──────────────

describe("结束入历史", () => {
  it("伴读死亡：旧关系进入历史，新关系留在 active（一条历史 + 一条新 active）", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = deadRoyal();
    s.heirCompanions["h1"] = activeAssignment("h1");
    s.nextCompanionAssignmentSeq = 1; // 已分配 _0，下一个为 _1（真实流程 seq 恒领先）
    const s2 = reconcile(s);

    expect(s2.endedCompanionAssignments.filter((a) => a.heirId === "h1")).toHaveLength(1);
    const hist = s2.endedCompanionAssignments[0]!;
    expect(hist.id).toBe("companion_assignment_h1_0");
    expect(hist.status).toBe("ended");
    expect(hist.endReason).toBe("companion_deceased");

    const active = s2.heirCompanions["h1"];
    expect(active).toBeDefined();
    expect(active!.status).toBe("active");
    expect(active!.id).not.toBe(hist.id);
    expect(active!.companion.personId).not.toBe("r1");
  });

  it("离校：active 被删除，历史保留", () => {
    const son = makeHeir("h1", 1, { sex: "son" });
    const s = makeState([son]);
    s.calendar = { ...s.calendar, year: 19 }; // age 18 → 离校
    s.heirCompanions["h1"] = { ...activeAssignment("h1"), companion: { kind: "royal_relative", personId: "r1" }, profile: { name: "旧", sex: "male", legitimate: true, personality: defaultPersonality } };
    s.nextCompanionAssignmentSeq = 1;
    s.royalRelatives["r1"] = { ...deadRoyal(), sex: "male", lifecycle: "alive" };
    const now19 = makeGameTime(19, 1, "early");
    const s2 = applyCompanionReconciliation(s, planCompanionReconciliation(db, s, now19), now19);
    expect(s2.heirCompanions["h1"]).toBeUndefined();
    expect(s2.endedCompanionAssignments.some((a) => a.id === "companion_assignment_h1_0" && a.endReason === "heir_left_school")).toBe(true);
  });
});

// ── 4：重复 apply 不重复写历史 ─────────────────────────────────────────────────

describe("幂等", () => {
  it("重复 apply 同一 plan 不重复写历史、不重复分配", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = deadRoyal();
    s.heirCompanions["h1"] = activeAssignment("h1");
    s.nextCompanionAssignmentSeq = 1; // 已分配 _0，下一个为 _1（真实流程 seq 恒领先）
    const plan = planCompanionReconciliation(db, s, NOW);
    const once = applyCompanionReconciliation(s, plan, NOW);
    const twice = applyCompanionReconciliation(once, plan, NOW);
    expect(twice.endedCompanionAssignments).toHaveLength(once.endedCompanionAssignments.length);
    expect(twice.heirCompanions["h1"]!.id).toBe(once.heirCompanions["h1"]!.id);
    expect(twice.nextCompanionAssignmentSeq).toBe(once.nextCompanionAssignmentSeq);
  });
});

// ── 5 & 6：两次替补 → 两段不同 ID；active/history ID 不重叠 ─────────────────────

describe("assignment ID", () => {
  it("两次替补产生两段不同 assignment ID，且 active/history ID 不重叠", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    // 第一段：宗室 fallback。
    const s1 = reconcile(s);
    const firstId = s1.heirCompanions["h1"]!.id;

    // 第一任死亡 → 替补。
    const firstPerson = s1.heirCompanions["h1"]!.companion.personId;
    const dead1 = { ...s1.royalRelatives[firstPerson]!, lifecycle: "deceased" as const, deceasedAt: NOW };
    const s2src = { ...s1, royalRelatives: { ...s1.royalRelatives, [firstPerson]: dead1 } };
    const s2 = reconcile(s2src);
    const secondId = s2.heirCompanions["h1"]!.id;

    expect(secondId).not.toBe(firstId);
    const activeIds = Object.values(s2.heirCompanions).map((a) => a.id);
    const historyIds = s2.endedCompanionAssignments.map((a) => a.id);
    expect(activeIds.filter((id) => historyIds.includes(id))).toHaveLength(0);
    expect(historyIds).toContain(firstId);
  });
});

// ── selectors ──────────────────────────────────────────────────────────────────

describe("selectors", () => {
  it("getActiveCompanion / getFormerCompanions / getCompanionAssignmentById", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = deadRoyal();
    s.heirCompanions["h1"] = activeAssignment("h1");
    s.nextCompanionAssignmentSeq = 1; // 已分配 _0，下一个为 _1（真实流程 seq 恒领先）
    const s2 = reconcile(s);

    const active = getActiveCompanion(s2, "h1")!;
    expect(active.status).toBe("active");
    expect(getActiveCompanion(s2, "ghost")).toBeUndefined();

    const formers = getFormerCompanions(s2, "h1");
    expect(formers).toHaveLength(1);
    expect(formers[0]!.id).toBe("companion_assignment_h1_0");

    expect(getCompanionAssignmentById(s2, active.id)!.id).toBe(active.id); // active
    expect(getCompanionAssignmentById(s2, "companion_assignment_h1_0")!.status).toBe("ended"); // history
    expect(getCompanionAssignmentById(s2, "nope")).toBeUndefined();
  });

  it("getFormerCompanions 按结束时间倒序", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.endedCompanionAssignments = [
      { ...activeAssignment("h1"), id: "a_old", status: "ended", endedAt: makeGameTime(6, 1, "early"), endReason: "companion_deceased" },
      { ...activeAssignment("h1"), id: "a_new", status: "ended", endedAt: makeGameTime(8, 1, "early"), endReason: "heir_left_school" },
    ];
    expect(getFormerCompanions(s, "h1").map((a) => a.id)).toEqual(["a_new", "a_old"]);
  });
});

// ── 11：live age selector 对历史回退快照 ──────────────────────────────────────

describe("resolveCompanionView 对历史", () => {
  it("来源人物已不存在时回退快照年龄", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    const histAssignment: HeirCompanionAssignment = {
      ...activeAssignment("h1"), id: "a_hist", status: "ended",
      endedAt: NOW, endReason: "companion_deceased", ageAtAssignment: 9,
      companion: { kind: "royal_relative", personId: "gone" },
    };
    const view = resolveCompanionView(s, histAssignment);
    expect(view.age).toBe(9); // 快照回退
    expect(view.name).toBe("亡友");
  });
});

// ── 9 & 10：validator ──────────────────────────────────────────────────────────

describe("validateCompanionWorld", () => {
  it("拒绝 active 带 endedAt", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = { ...deadRoyal(), lifecycle: "alive" };
    s.heirCompanions["h1"] = { ...activeAssignment("h1"), endedAt: NOW };
    const errs = validateCompanionWorld(s);
    expect(errs.some((e) => e.code === "COMPANION_ACTIVE_HAS_END")).toBe(true);
  });

  it("拒绝 active map 中 status=ended", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = { ...deadRoyal(), lifecycle: "alive" };
    s.heirCompanions["h1"] = { ...activeAssignment("h1"), status: "ended", endedAt: NOW, endReason: "dismissed" };
    expect(validateCompanionWorld(s).some((e) => e.code === "COMPANION_ACTIVE_MAP_NOT_ACTIVE")).toBe(true);
  });

  it("拒绝历史缺 endReason", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.endedCompanionAssignments = [{ ...activeAssignment("h1"), id: "a_h", status: "ended", endedAt: NOW }];
    expect(validateCompanionWorld(s).some((e) => e.code === "COMPANION_ENDED_MISSING_FIELDS")).toBe(true);
  });

  it("拒绝 active 与历史 ID 重复", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = { ...deadRoyal(), lifecycle: "alive" };
    s.heirCompanions["h1"] = activeAssignment("h1");
    s.nextCompanionAssignmentSeq = 1; // 已分配 _0，下一个为 _1（真实流程 seq 恒领先）
    s.endedCompanionAssignments = [{ ...activeAssignment("h1"), status: "ended", endedAt: NOW, endReason: "dismissed" }];
    expect(validateCompanionWorld(s).some((e) => e.code === "COMPANION_DUPLICATE_ID")).toBe(true);
  });

  it("历史人物已死被接受（无 dangling 报错）", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = deadRoyal(); // deceased
    s.endedCompanionAssignments = [{ ...activeAssignment("h1"), status: "ended", endedAt: NOW, endReason: "companion_deceased" }];
    expect(validateCompanionWorld(s)).toHaveLength(0);
  });
});

// ── 12：不可变 ──────────────────────────────────────────────────────────────────

describe("不可变", () => {
  it("apply 不修改输入 state 的 history/active/seq", () => {
    const heir = makeHeir("h1", 1);
    const s = makeState([heir]);
    s.royalRelatives["r1"] = deadRoyal();
    s.heirCompanions["h1"] = activeAssignment("h1");
    s.nextCompanionAssignmentSeq = 1; // 已分配 _0，下一个为 _1（真实流程 seq 恒领先）
    const beforeHist = s.endedCompanionAssignments;
    const beforeActive = s.heirCompanions;
    const beforeSeq = s.nextCompanionAssignmentSeq;
    const s2 = reconcile(s);
    expect(s.endedCompanionAssignments).toBe(beforeHist);
    expect(s.heirCompanions).toBe(beforeActive);
    expect(s.nextCompanionAssignmentSeq).toBe(beforeSeq);
    expect(s2.endedCompanionAssignments).not.toBe(beforeHist);
  });
});
