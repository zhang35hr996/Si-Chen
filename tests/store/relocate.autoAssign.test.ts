import { describe, it, expect } from "vitest";
import { autoAssignChamber } from "../../src/store/relocate";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);

describe("autoAssignChamber", () => {
  it("高位分（正三品以上）优先分配主殿", () => {
    // Find a rank with grade 一二三品
    const highRankId = Object.entries(db.ranks).find(
      ([, r]) => r.grade && (r.grade.includes("二品") || r.grade.includes("三品")) && r.domain === "harem",
    )?.[0];
    if (!highRankId) return; // skip if no such rank in content
    const result = autoAssignChamber(db, base, highRankId);
    expect(result).not.toBeNull();
    expect(result!.chamberId).toBe("main");
  });

  it("六七品侍君优先分配东偏殿", () => {
    const midRankId = Object.entries(db.ranks).find(
      ([, r]) => r.grade && (r.grade.includes("六品") || r.grade.includes("七品")) && r.domain === "harem",
    )?.[0];
    if (!midRankId) return;
    const result = autoAssignChamber(db, base, midRankId);
    expect(result).not.toBeNull();
    expect(result!.chamberId).toBe("east_annex");
  });

  it("空宫室时返回位置和宫室 ID（非 null）", () => {
    const anyRankId = Object.keys(db.ranks).find((id) => db.ranks[id]?.domain === "harem");
    if (!anyRankId) return;
    const result = autoAssignChamber(db, base, anyRankId);
    expect(result).not.toBeNull();
    expect(result!.locationId).toBeTruthy();
    expect(result!.chamberId).toBeTruthy();
  });
});
