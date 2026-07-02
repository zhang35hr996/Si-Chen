/**
 * Save format v38 → v39 migration tests (PR4C-1：伴读关系身份与历任历史)。
 *
 * v39：active assignment 补稳定 id；遗留 ended map 条目迁入 endedCompanionAssignments；
 * 补 nextCompanionAssignmentSeq。结构重排，显式 normalize。
 */
import { describe, expect, it } from "vitest";
import {
  SAVE_FORMAT_VERSION,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

const personality = { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 };
const gt = (y: number, m: number) => ({ year: y, month: m, period: "early" as const, dayIndex: 0 });

/** Build a v38 save whose heirCompanions lack id and contain a stray ended entry. */
function makeV38Save(): string {
  const s = createNewGameState(db);
  // 两个皇嗣 + 一个宗室人物供引用
  s.resources.bloodline.heirs = [
    { id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign", birthAt: gt(1, 1), favor: 50, legitimate: false, petName: "", education: { scholarship: 10, martial: 10, virtue: 10 }, health: 70, talent: 50, diligence: 50, personality, interests: [], imperialFear: 20, neglect: 20, custodianBond: 0, portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" }, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive" },
    { id: "heir_000002", sex: "daughter", fatherId: null, bearer: "sovereign", birthAt: gt(1, 1), favor: 50, legitimate: false, petName: "", education: { scholarship: 10, martial: 10, virtue: 10 }, health: 70, talent: 50, diligence: 50, personality, interests: [], imperialFear: 20, neglect: 20, custodianBond: 0, portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" }, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive" },
  ];
  s.royalRelatives = {
    r_a: { id: "r_a", name: "甲友", sex: "female", age: 6, branch: "close", branchPrestige: 50, legitimate: true, personality, lifecycle: "alive" },
    r_b: { id: "r_b", name: "乙友", sex: "female", age: 6, branch: "close", branchPrestige: 50, legitimate: true, personality, lifecycle: "deceased", deceasedAt: gt(2, 1) },
  };

  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  // v38 形状：heirCompanions 无 id；含一个遗留 ended 条目；无历史/seq 字段。
  raw["heirCompanions"] = {
    heir_000001: { heirId: "heir_000001", companion: { kind: "royal_relative", personId: "r_a" }, assignedAt: gt(2, 1), status: "active", bond: 5, ageAtAssignment: 6, profile: { name: "甲友", sex: "female", legitimate: true, personality } },
    heir_000002: { heirId: "heir_000002", companion: { kind: "royal_relative", personId: "r_b" }, assignedAt: gt(2, 1), status: "ended", endedAt: gt(3, 1), endReason: "companion_deceased", bond: 8, ageAtAssignment: 6, profile: { name: "乙友", sex: "female", legitimate: true, personality } },
  };
  delete raw["endedCompanionAssignments"];
  delete raw["nextCompanionAssignmentSeq"];

  const current = createSaveData(db, s, "slot1");
  const env = { ...current, formatVersion: 38, state: raw, checksum: checksumOf(raw as unknown as GameState) };
  return JSON.stringify(env);
}

describe("save migration v38 → v39", () => {
  it("V39-01: SAVE_FORMAT_VERSION >= 39", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(39);
  });

  it("V39-02: 旧档 active assignment 无 id → 稳定补 legacy id", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const active = loaded.value.state.heirCompanions["heir_000001"];
    expect(active).toBeDefined();
    expect(active!.id).toBe("companion_assignment_heir_000001_legacy");
    expect(active!.status).toBe("active");
  });

  it("V39-03: 旧档 ended map 条目迁入 endedCompanionAssignments，并离开 active", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const st = loaded.value.state;
    // ended 的 heir_000002 已离开 active map
    expect(st.heirCompanions["heir_000002"]).toBeUndefined();
    // 迁入历史，带稳定 id + endedAt/endReason
    const hist = st.endedCompanionAssignments.find((a) => a.heirId === "heir_000002");
    expect(hist).toBeDefined();
    expect(hist!.id).toBe("companion_assignment_heir_000002_legacy");
    expect(hist!.status).toBe("ended");
    expect(hist!.endReason).toBe("companion_deceased");
  });

  it("V39-04: nextCompanionAssignmentSeq 越过已分配数量，避免未来 id 冲突", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.nextCompanionAssignmentSeq).toBeGreaterThanOrEqual(2);
  });

  // 回归：真实 heirId（heir_NNNNNN 数字结尾）+ 仅一名在读伴读——最常见的旧档形态。
  // legacy id 若以数字结尾会被 companionAssignmentSequence 误解析成伪序号，导致
  // validateCompanionWorld 报 COMPANION_SEQUENCE_NOT_AHEAD、迁移档无法加载。
  it("V39-05: 单个 active 伴读、数字结尾 heirId 的旧档可迁移并通过校验", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.heirs = [
      { id: "heir_000006", sex: "daughter", fatherId: null, bearer: "sovereign", birthAt: gt(1, 1), favor: 50, legitimate: false, petName: "", education: { scholarship: 10, martial: 10, virtue: 10 }, health: 70, talent: 50, diligence: 50, personality, interests: [], imperialFear: 20, neglect: 20, custodianBond: 0, portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" }, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive" },
    ];
    s.royalRelatives = {
      r_a: { id: "r_a", name: "甲友", sex: "female", age: 6, branch: "close", branchPrestige: 50, legitimate: true, personality, lifecycle: "alive" },
    };
    const raw = structuredClone(s) as unknown as Record<string, unknown>;
    raw["heirCompanions"] = {
      heir_000006: { heirId: "heir_000006", companion: { kind: "royal_relative", personId: "r_a" }, assignedAt: gt(2, 1), status: "active", bond: 5, ageAtAssignment: 6, profile: { name: "甲友", sex: "female", legitimate: true, personality } },
    };
    delete raw["endedCompanionAssignments"];
    delete raw["nextCompanionAssignmentSeq"];
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 38, state: raw, checksum: checksumOf(raw as unknown as GameState) };

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const active = loaded.value.state.heirCompanions["heir_000006"];
    expect(active!.id).toBe("companion_assignment_heir_000006_legacy");
  });
});
