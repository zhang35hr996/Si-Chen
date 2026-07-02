import { describe, it, expect } from "vitest";
import { createInitialState } from "../../../src/engine/state/initialState";
import {
  getBiologicalParents, getLegalParents,
  getLegalChildren, getBiologicalAncestors, getLegalDescendants,
} from "../../../src/engine/characters/parentage/parentageSelectors";
import { SOVEREIGN_PERSON_ID, type GameState } from "../../../src/engine/state/types";

function withParentage(): GameState {
  const s = createInitialState();
  // 人工构造 bio/legal 分歧：heir_a 生身父 shen_zhibai，法统父 xie_minglang（模拟未来过继）。
  s.parentage = {
    heir_a: { biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: "shen_zhibai",
              legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: "xie_minglang" },
    heir_b: { biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: null,
              legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: null },
    heir_a1: { biologicalMotherId: "heir_a", biologicalFatherId: "consort_x",
               legalMotherId: "heir_a", legalFatherId: "consort_x" },
  };
  return s;
}

describe("parentage selectors", () => {
  it("getBiologicalParents 返回 ParentPair（含 null father）", () => {
    expect(getBiologicalParents(withParentage(), "heir_b"))
      .toEqual({ motherId: SOVEREIGN_PERSON_ID, fatherId: null });
  });
  it("bio 与 legal 链可区分", () => {
    const s = withParentage();
    expect(getBiologicalParents(s, "heir_a")!.fatherId).toBe("shen_zhibai");
    expect(getLegalParents(s, "heir_a")!.fatherId).toBe("xie_minglang");
  });
  it("无记录返回 undefined", () => {
    expect(getBiologicalParents(withParentage(), "unknown_child")).toBeUndefined();
  });
  it("getLegalChildren 按 id 升序", () => {
    expect(getLegalChildren(withParentage(), SOVEREIGN_PERSON_ID)).toEqual(["heir_a", "heir_b"]);
  });
  it("getLegalDescendants 世代 BFS", () => {
    expect(getLegalDescendants(withParentage(), SOVEREIGN_PERSON_ID)).toEqual(["heir_a", "heir_b", "heir_a1"]);
  });
  it("getBiologicalAncestors 母系优先、带 visited 防环", () => {
    expect(getBiologicalAncestors(withParentage(), "heir_a1"))
      .toEqual(["heir_a", "consort_x", SOVEREIGN_PERSON_ID, "shen_zhibai"]);
  });
});
