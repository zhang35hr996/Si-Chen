import { describe, expect, it } from "vitest";
import { CHAMBERED_PALACE_ORDER } from "../../src/engine/characters/chambers";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  autoAssignResidence,
  automaticChamberPreferences,
  palaceChambers,
  type ResidenceAssignment,
} from "../../src/store/relocate";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function rankWithGrade(pattern: RegExp): string {
  const rank = Object.values(db.ranks).find((candidate) => pattern.test(candidate.grade));
  if (!rank) throw new Error(`No rank found for ${pattern}`);
  return rank.id;
}

describe("automaticChamberPreferences", () => {
  it("主殿只向正四品及以上开放", () => {
    expect(automaticChamberPreferences("正三品第一序")).toEqual(["main", "east_side"]);
    expect(automaticChamberPreferences("正四品第二序")).toEqual(["main", "west_side"]);
    expect(automaticChamberPreferences("从四品")).toEqual(["west_side"]);
    expect(automaticChamberPreferences("正五品")).toEqual(["west_side"]);
  });

  it("六七品取东偏殿，八九品取西偏殿", () => {
    expect(automaticChamberPreferences("正六品")).toEqual(["east_annex"]);
    expect(automaticChamberPreferences("从七品")).toEqual(["east_annex"]);
    expect(automaticChamberPreferences("正八品")).toEqual(["west_annex"]);
    expect(automaticChamberPreferences("从九品")).toEqual(["west_annex"]);
  });
});

describe("autoAssignResidence", () => {
  it("只返回符合位分规则且实际空置的宫室", () => {
    const state = createNewGameState(db, 1);
    const rankId = rankWithGrade(/^正六品|^从六品/);
    const assignment = autoAssignResidence(db, state, rankId);

    expect(assignment).not.toBeNull();
    expect(assignment?.chamber).toBe("east_annex");
    const slot = palaceChambers(db, state, assignment!.location)
      .find((candidate) => candidate.id === assignment!.chamber);
    expect(slot?.occupant).toBeUndefined();
  });

  it("高位主殿全部占用或预留后，再寻找东侧殿", () => {
    const state = createNewGameState(db, 1);
    const rankId = rankWithGrade(/^正二品|^从二品/);
    const reserved: ResidenceAssignment[] = CHAMBERED_PALACE_ORDER.map((location) => ({
      location,
      chamber: "main",
    }));
    const assignment = autoAssignResidence(db, state, rankId, reserved);

    expect(assignment).not.toBeNull();
    expect(assignment?.chamber).toBe("east_side");
  });

  it("没有符合品级规则的空室时返回 null，让侍君暂住储秀宫", () => {
    const state = createNewGameState(db, 1);
    const rankId = rankWithGrade(/^正六品|^从六品/);
    const reserved: ResidenceAssignment[] = CHAMBERED_PALACE_ORDER.map((location) => ({
      location,
      chamber: "east_annex",
    }));

    expect(autoAssignResidence(db, state, rankId, reserved)).toBeNull();
  });
});
