import { describe, expect, it } from "vitest";
import { appendCondition, conditionId } from "../../src/engine/chronicle/conditions";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

describe("appendCondition", () => {
  it("按 owner 单调 id，不改入参", () => {
    expect(conditionId("gu", 1)).toBe("cond_gu_000001");
    const s0 = createInitialState();
    const s1 = appendCondition(s0, { ownerId: "gu", type: "acute_grief", sourceEventId: "evt_000001", severity: 90, startedAt: makeGameTime(1,5,"mid"), recoveryProfile: "slow" });
    expect(s1.emotionalConditions[0]!.id).toBe("cond_gu_000001");
    expect(s0.emotionalConditions).toHaveLength(0);
    const s2 = appendCondition(s1, { ownerId: "gu", type: "anxiety", sourceEventId: "evt_000002", severity: 40, startedAt: makeGameTime(1,6,"mid"), recoveryProfile: "normal" });
    expect(s2.emotionalConditions[1]!.id).toBe("cond_gu_000002");
  });
});
