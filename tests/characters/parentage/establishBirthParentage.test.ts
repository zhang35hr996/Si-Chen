import { describe, it, expect } from "vitest";
import { createInitialState } from "../../../src/engine/state/initialState";
import { establishBirthParentage, buildBirthParentage } from "../../../src/engine/characters/parentage/establishBirthParentage";
import { SOVEREIGN_PERSON_ID } from "../../../src/engine/state/types";

describe("establishBirthParentage", () => {
  it("buildBirthParentage：legal=bio，母=sovereign，自孕 father=null", () => {
    expect(buildBirthParentage(null)).toEqual({
      biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: null,
      legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: null,
    });
  });
  it("初始化写入 parentage", () => {
    const r = establishBirthParentage(createInitialState(), { childId: "heir_000001", biologicalFatherId: "c1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.parentage["heir_000001"]?.legalFatherId).toBe("c1");
  });
  it("重复建立返回 PARENTAGE_ALREADY_ESTABLISHED 且不改输入", () => {
    const s = createInitialState();
    const first = establishBirthParentage(s, { childId: "heir_000001", biologicalFatherId: "c1" });
    expect(first.ok).toBe(true);
    const base = first.ok ? first.value : s;
    const dup = establishBirthParentage(base, { childId: "heir_000001", biologicalFatherId: "c2" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error[0]?.code).toBe("PARENTAGE_ALREADY_ESTABLISHED"); // noUncheckedIndexedAccess
    expect(base.parentage["heir_000001"]?.biologicalFatherId).toBe("c1"); // 未被改
  });
});
