import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

describe("mentionLog schema", () => {
  it("初始空 + 合法条目通过", () => {
    const s = createInitialState();
    expect(s.mentionLog).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.mentionLog.push({ speakerId: "a", audienceId: "player", memoryId: "m", mentionedAt: makeGameTime(1, 1, "early") });
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});
