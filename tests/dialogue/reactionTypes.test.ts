import { describe, expect, it } from "vitest";
import type { ReactionPlan } from "../../src/engine/dialogue/reactionTypes";

describe("ReactionPlan 形状", () => {
  it("可构造 primary+undertone 的口是心非计划", () => {
    const plan: ReactionPlan = {
      subjectIds: ["consort_gu"], primary: "congratulate",
      undertone: { type: "envy", intensity: 70, concealment: 85 },
      intensity: 45, openness: 30,
      claimNeeds: [{ about: "subject_event", subjectId: "consort_gu" }],
      rationaleCodes: ["birth_competitor_concealed_envy"],
    };
    expect(plan.primary).toBe("congratulate");
    expect(plan.undertone?.type).toBe("envy");
  });
});
