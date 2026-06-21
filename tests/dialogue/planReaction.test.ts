import { describe, expect, it } from "vitest";
import { planReaction } from "../../src/engine/dialogue/planReaction";
import { deriveSubjectRelation } from "../../src/engine/dialogue/subjectRelation";
import { DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";
import type { AudienceContext, EventReactionContext } from "../../src/engine/dialogue/reactionTypes";

const sovereign: AudienceContext = { targetRole: "sovereign", privacy: "private", presentCharacterIds: [] };
const consortPrivate: AudienceContext = { targetRole: "consort", privacy: "private", presentCharacterIds: [] };
const rel = (attitude: string, over = {}) => deriveSubjectRelation({ charId: "gu", authoredAttitude: attitude, ...over }).relation;
const demote: EventReactionContext = { eventType: "rank_changed", subjectId: "gu", direction: "demote" };
const birth: EventReactionContext = { eventType: "heir_born", subjectId: "gu" };
const died: EventReactionContext = { eventType: "heir_died", subjectId: "gu" };

describe("planReaction", () => {
  it("降位+盟友+对陛下 → 求情/辩护", () => {
    const p = planReaction({ relation: rel("交好"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(["petition", "defend"]).toContain(p.primary);
  });
  it("降位+仇敌+对陛下 → 不当面幸灾乐祸（收敛），潜 contempt", () => {
    const p = planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(p.primary).not.toBe("gloat");
    expect(p.undertone?.type === "contempt" || p.undertone === undefined).toBe(true);
  });
  it("降位+仇敌+私下对侍君 → 可幸灾乐祸", () => {
    const p = planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: demote });
    expect(p.primary).toBe("gloat");
  });
  it("高 discretion 仇敌即便私下也克制（半私场合）", () => {
    const semi: AudienceContext = { targetRole: "consort", privacy: "semi_private", presentCharacterIds: ["x"] };
    const p = planReaction({ relation: rel("交恶"), disposition: { ...DEFAULT_DISPOSITION, discretion: 95 }, audience: semi, event: demote });
    expect(p.primary).not.toBe("gloat");
  });
  it("生育+争宠者+对陛下 → 表面恭贺、潜 envy（高 concealment）", () => {
    const p = planReaction({ relation: rel("争宠", { favorThreat: 40 }), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: birth });
    expect(p.primary).toBe("congratulate");
    expect(p.undertone?.type).toBe("envy");
    expect(p.undertone!.concealment).toBeGreaterThan(60);
  });
  it("夭折+挚友 → 安慰、潜 grief", () => {
    const p = planReaction({ relation: rel("敬爱"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: died });
    expect(p.primary).toBe("comfort");
  });
  it("确定性 + 兜底（中性+搬迁 → remain_reserved/agree）", () => {
    const res: EventReactionContext = { eventType: "residence_changed", subjectId: "gu" };
    const p = planReaction({ relation: rel(""), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: res });
    expect(["remain_reserved", "agree"]).toContain(p.primary);
    expect(planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote }))
      .toEqual(planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote }));
  });
});
