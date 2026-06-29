/**
 * 证明 validateParentage 真的接入 readSlot：schema 合法但某 heir 缺 parentage 时，
 * readSlot 必须失败并 quarantine（堵住「unit 全绿但未接线」的漏洞）。
 */
import { describe, it, expect } from "vitest";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("readSlot parentage validation 接线", () => {
  it("schema 合法但某 heir 缺 parentage → readSlot 失败并 quarantine", () => {
    const s = createNewGameState(db);
    // 注入一名 heir 但故意不给它 parentage（heir schema 不要求 parentage，故 schema 仍通过）
    (s.resources.bloodline.heirs as unknown as Array<Record<string, unknown>>).push({
      id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"), favor: 10, legitimate: true, petName: "",
      education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50,
      personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
      interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
      portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
      ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive", healthStatus: "healthy",
    });
    // parentage 保持为空 {}（来自 createNewGameState）

    const storage = createMemoryStorage();
    const env = { ...createSaveData(db, s, "slot1"), checksum: checksumOf(s) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.code).toBe("PARENTAGE_INTEGRITY");
    // 已 quarantine：原 slot 不再可正常读出该状态
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
  });
});
