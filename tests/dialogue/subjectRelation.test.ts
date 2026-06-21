import { describe, expect, it } from "vitest";
import { deriveSubjectRelation, STANCE_DEFAULTS } from "../../src/engine/dialogue/subjectRelation";

describe("deriveSubjectRelation", () => {
  it("交好→friendly 基线向量", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "交好" }).relation;
    expect(r.stance).toBe("friendly");
    expect(r.affection).toBe(STANCE_DEFAULTS.friendly.affection);
  });
  it("防备→neutral（不映射 hostile），低 trust", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "防备" }).relation;
    expect(r.stance).toBe("neutral");
  });
  it("动态 affection 微调数值但不翻转 stance：长期交恶+近期缓和", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "交恶", standingAffection: 40 }).relation;
    expect(r.stance).toBe("hostile"); // 叙事方向不变
    expect(r.affection).toBeGreaterThan(STANCE_DEFAULTS.hostile.affection); // 数值被拉高
  });
  it("favorThreat 升 envy（争宠者）", () => {
    const base = deriveSubjectRelation({ charId: "a", authoredAttitude: "争宠" }).relation;
    const threatened = deriveSubjectRelation({ charId: "a", authoredAttitude: "争宠", favorThreat: 30 }).relation;
    expect(threatened.envy).toBeGreaterThan(base.envy);
  });
  it("未识别 attitude→neutral + 诊断（不猜测、不报错）", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "若即若离" });
    expect(r.relation.stance).toBe("neutral");
    expect(r.diagnostics).toContainEqual({ code: "unknown_authored_attitude", value: "若即若离" });
  });
  it("缺 attitude→neutral 无诊断；确定性", () => {
    expect(deriveSubjectRelation({ charId: "a" }).relation.stance).toBe("neutral");
    expect(deriveSubjectRelation({ charId: "a", authoredAttitude: "嫉妒" }))
      .toEqual(deriveSubjectRelation({ charId: "a", authoredAttitude: "嫉妒" }));
  });
});
