import { describe, expect, it } from "vitest";
import { deriveSubjectRelation, STANCE_DEFAULTS } from "../../src/engine/dialogue/subjectRelation";

describe("deriveSubjectRelation", () => {
  it("friendly 基线向量", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredStance: "friendly" }).relation;
    expect(r.stance).toBe("friendly");
    expect(r.affection).toBe(STANCE_DEFAULTS.friendly.affection);
  });
  it("动态 affection 微调数值但不翻转 stance：长期 hostile + 近期缓和", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredStance: "hostile", standingAffection: 40 }).relation;
    expect(r.stance).toBe("hostile"); // 叙事方向不变
    expect(r.affection).toBeGreaterThan(STANCE_DEFAULTS.hostile.affection); // 数值被拉高
  });
  it("favorThreat 升 envy（competitive 者）", () => {
    const base = deriveSubjectRelation({ charId: "a", authoredStance: "competitive" }).relation;
    const threatened = deriveSubjectRelation({ charId: "a", authoredStance: "competitive", favorThreat: 30 }).relation;
    expect(threatened.envy).toBeGreaterThan(base.envy);
  });
  it("缺 stance→neutral；确定性", () => {
    expect(deriveSubjectRelation({ charId: "a" }).relation.stance).toBe("neutral");
    expect(deriveSubjectRelation({ charId: "a", authoredStance: "competitive" }))
      .toEqual(deriveSubjectRelation({ charId: "a", authoredStance: "competitive" }));
  });
});
