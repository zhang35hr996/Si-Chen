import { describe, expect, it } from "vitest";
import { effectiveStrength, MEMORY_CONFIG } from "../../src/engine/dialogue/decay";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

function mem(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "m", ownerId: "a", kind: "impression", subjectIds: ["x"], perspective: "witness",
    summary: "x", strength: 80, retention: "slow", emotions: {}, triggerTags: [], unresolved: false,
    createdAt: makeGameTime(1, 1, "early"), ...over,
  };
}

describe("effectiveStrength", () => {
  it("permanent 不随时间衰减", () => {
    const m = mem({ retention: "permanent", strength: 100, createdAt: makeGameTime(1, 1, "early") });
    expect(effectiveStrength(m, makeGameTime(5, 1, "early"))).toBe(100);
  });
  it("fast 一个半衰期后约减半（75 天≈25 行动日）", () => {
    // dayIndex: 1 行动日 = 1/3 月? 见 calendar：1 月=3 行动日。75 天 ≈ 取 ageDays 直接用 dayIndex 差。
    const m = mem({ retention: "fast", strength: 80, createdAt: makeGameTime(1, 1, "early") });
    const halfLifeDays = MEMORY_CONFIG.halfLifeDays.fast;
    // 构造 age ≈ halfLife 的 now：用 makeGameTime 选一个 dayIndex 差 ≈ halfLifeDays 的时刻
    const now = makeGameTime(1, 1, "early");
    const future = { ...now, dayIndex: now.dayIndex + halfLifeDays };
    expect(effectiveStrength(m, future)).toBeCloseTo(40, 0);
  });
  it("当下（age 0）= strength", () => {
    const m = mem({ retention: "slow", strength: 60 });
    expect(effectiveStrength(m, makeGameTime(1, 1, "early"))).toBe(60);
  });
  it("确定性", () => {
    const m = mem({ retention: "slow" });
    const now = makeGameTime(2, 1, "early");
    expect(effectiveStrength(m, now)).toBe(effectiveStrength(m, now));
  });
});
