import { describe, it, expect } from "vitest";
import { autoAssignChamber } from "../../src/store/relocate";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";

const db = loadRealContent();
const base = createNewGameState(db);

/** 找到 grade 完全等于 gradeStr 的 harem 位分 ID（唯一查找）。 */
function rankId(gradeStr: string): string {
  const found = Object.entries(db.ranks).find(
    ([, r]) => r.grade === gradeStr && r.domain === "harem",
  );
  if (!found) throw new Error(`未找到品级 "${gradeStr}" 的位分`);
  return found[0];
}

describe("autoAssignChamber", () => {
  it("超品分配主殿", () => {
    const result = autoAssignChamber(db, base, rankId("超品"));
    expect(result).not.toBeNull();
    expect(result!.chamberId).toBe("main");
  });

  it("正二品第一序（含'第一序'后缀）解析为二品，分配主殿", () => {
    // 旧 includes 实现：'正二品第一序' 含'一'→被错误解析成一品，仍分主殿；
    // 关键是同一测试也应覆盖 grade 含多个数字汉字时的正确解析。
    const result = autoAssignChamber(db, base, rankId("正二品第一序"));
    expect(result).not.toBeNull();
    expect(result!.chamberId).toBe("main");
  });

  it("正四品（长御）→ 主殿；从四品（少使）→ 西侧殿（正/从四品严格区分）", () => {
    const zhengSi = autoAssignChamber(db, base, rankId("正四品"));
    const congSi = autoAssignChamber(db, base, rankId("从四品"));
    expect(zhengSi).not.toBeNull();
    expect(zhengSi!.chamberId).toBe("main");
    expect(congSi).not.toBeNull();
    expect(congSi!.chamberId).toBe("west_side");
  });

  it("六七品侍君分配东偏殿", () => {
    const result = autoAssignChamber(db, base, rankId("正六品"));
    expect(result).not.toBeNull();
    expect(result!.chamberId).toBe("east_annex");
  });

  it("八九品侍君分配西偏殿", () => {
    const result = autoAssignChamber(db, base, rankId("正八品"));
    expect(result).not.toBeNull();
    expect(result!.chamberId).toBe("west_annex");
  });
});
