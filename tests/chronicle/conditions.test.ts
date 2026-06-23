import { describe, expect, it } from "vitest";
import { appendCondition, conditionId, effectiveConditionSeverity } from "../../src/engine/chronicle/conditions";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { EmotionalCondition } from "../../src/engine/state/types";

const cond = (over: Partial<EmotionalCondition> = {}): EmotionalCondition => ({
  id: "cond_a_000001",
  ownerId: "a",
  type: "acute_grief",
  sourceEventId: "evt_1",
  severity: 100,
  startedAt: makeGameTime(1, 1, "early"),
  recoveryProfile: "fast",
  ...over,
});

describe("effectiveConditionSeverity", () => {
  it("returns full severity at age 0 (just started)", () => {
    expect(effectiveConditionSeverity(cond(), makeGameTime(1, 1, "early"))).toBe(100);
  });

  it("a 'stuck' condition never decays", () => {
    const stuck = cond({ recoveryProfile: "stuck", severity: 70 });
    expect(effectiveConditionSeverity(stuck, makeGameTime(1, 1, "early"))).toBe(70);
    expect(effectiveConditionSeverity(stuck, makeGameTime(20, 1, "early"))).toBe(70);
  });

  it("an acute (fast) condition fades toward zero over the years", () => {
    const acute = cond({ recoveryProfile: "fast" });
    const soon = effectiveConditionSeverity(acute, makeGameTime(1, 2, "early"));
    const muchLater = effectiveConditionSeverity(acute, makeGameTime(6, 1, "early"));
    expect(soon).toBeGreaterThan(muchLater);
    expect(muchLater).toBeLessThan(5);
  });

  it("decays faster for 'fast' than 'slow' at the same age", () => {
    const at = makeGameTime(2, 1, "early"); // one year on
    const fast = effectiveConditionSeverity(cond({ recoveryProfile: "fast" }), at);
    const slow = effectiveConditionSeverity(cond({ recoveryProfile: "slow" }), at);
    expect(fast).toBeLessThan(slow);
  });

  it("never goes negative or above the starting severity", () => {
    const c = cond({ severity: 50, recoveryProfile: "normal" });
    const v = effectiveConditionSeverity(c, makeGameTime(40, 1, "early"));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(50);
  });
});

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
