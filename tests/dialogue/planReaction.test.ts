import { describe, expect, it } from "vitest";
import { planReaction } from "../../src/engine/dialogue/planReaction";
import { deriveSubjectRelation } from "../../src/engine/dialogue/subjectRelation";
import { DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";
import type { AudienceContext, EventReactionContext } from "../../src/engine/dialogue/reactionTypes";
import type { RelationStance } from "../../src/engine/dialogue/subjectRelation";

const sovereign: AudienceContext = { targetRole: "sovereign", privacy: "private", presentCharacterIds: [] };
const consortPrivate: AudienceContext = { targetRole: "consort", privacy: "private", presentCharacterIds: [] };
const rel = (stance: RelationStance | undefined, over = {}) =>
  deriveSubjectRelation({ charId: "gu", ...(stance ? { authoredStance: stance } : {}), ...over }).relation;
const demote: EventReactionContext = { eventType: "rank_changed", subjectId: "gu", direction: "demote" };
const birth: EventReactionContext = { eventType: "heir_born", subjectId: "gu" };
const died: EventReactionContext = { eventType: "heir_died", subjectId: "gu" };

describe("planReaction", () => {
  it("降位+盟友+对陛下 → 求情/辩护", () => {
    const p = planReaction({ relation: rel("friendly"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(["petition", "defend"]).toContain(p.primary);
  });
  it("降位+忠心盟友(devoted)+对陛下 → 辩护(defend)", () => {
    const p = planReaction({ relation: rel("devoted"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(p.primary).toBe("defend");
  });
  it("降位+友好盟友(friendly)+对陛下 → 求情(petition)", () => {
    const p = planReaction({ relation: rel("friendly"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(p.primary).toBe("petition");
  });
  it("降位+仇敌+对陛下 → 不当面幸灾乐祸（收敛），潜 contempt", () => {
    const p = planReaction({ relation: rel("hostile"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(p.primary).not.toBe("gloat");
    expect(p.undertone?.type).toBe("contempt");
  });
  it("降位+仇敌+私下对侍君 → 可幸灾乐祸", () => {
    const p = planReaction({ relation: rel("hostile"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: demote });
    expect(p.primary).toBe("gloat");
  });
  it("高 discretion 仇敌即便私下也克制（半私场合）", () => {
    const semi: AudienceContext = { targetRole: "consort", privacy: "semi_private", presentCharacterIds: ["x"] };
    const p = planReaction({ relation: rel("hostile"), disposition: { ...DEFAULT_DISPOSITION, discretion: 95 }, audience: semi, event: demote });
    expect(p.primary).not.toBe("gloat");
  });
  it("生育+争宠者+对陛下 → 表面恭贺、潜 envy（高 concealment）", () => {
    const p = planReaction({ relation: rel("competitive", { favorThreat: 40 }), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: birth });
    expect(p.primary).toBe("congratulate");
    expect(p.undertone?.type).toBe("envy");
    expect(p.undertone!.concealment).toBeGreaterThan(60);
  });
  it("生育+仇敌+任意听众 → 表面恭贺、潜 resentment", () => {
    const p = planReaction({ relation: rel("hostile"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: birth });
    expect(p.primary).toBe("congratulate");
    expect(p.undertone?.type).toBe("resentment");
  });
  it("夭折+挚友 → 安慰、潜 grief", () => {
    const p = planReaction({ relation: rel("devoted"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: died });
    expect(p.primary).toBe("comfort");
  });
  it("rank_changed 缺 direction → remain_reserved（不当 promote 处理）", () => {
    const noDir = { eventType: "rank_changed", subjectId: "gu" } as EventReactionContext;
    const p = planReaction({ relation: rel("friendly"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: noDir });
    expect(p.primary).toBe("remain_reserved");
  });
  it("确定性 + 兜底（中性+搬迁 → remain_reserved/agree）", () => {
    const res: EventReactionContext = { eventType: "residence_changed", subjectId: "gu" };
    const p = planReaction({ relation: rel(undefined), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: res });
    expect(["remain_reserved", "agree"]).toContain(p.primary);
    expect(planReaction({ relation: rel("hostile"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote }))
      .toEqual(planReaction({ relation: rel("hostile"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote }));
  });
});
