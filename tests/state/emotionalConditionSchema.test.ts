import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

describe("emotionalConditions schema", () => {
  it("初始空数组通过；合法 condition 通过；非法 type 拒绝", () => {
    const s = createInitialState();
    expect(s.emotionalConditions).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.emotionalConditions.push({ id: "cond_gu_000001", ownerId: "gu", type: "acute_grief", sourceEventId: "evt_000001", severity: 90, startedAt: makeGameTime(1,5,"mid"), recoveryProfile: "slow" });
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.emotionalConditions.push({ ...s.emotionalConditions[0]!, id: "cond_gu_000002", type: "boredom" as never });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });
});
