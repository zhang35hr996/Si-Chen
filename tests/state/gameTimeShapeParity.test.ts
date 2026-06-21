import { describe, expect, it } from "vitest";
import { gameTimeShape } from "../../src/engine/content/schemas";
import { gameTimeSchema } from "../../src/engine/save/stateSchema";

const valid = { year: 1, month: 5, period: "mid", dayIndex: 13 };
const invalids = [
  { year: 0, month: 5, period: "mid", dayIndex: 13 },
  { year: 1, month: 13, period: "mid", dayIndex: 13 },
  { year: 1, month: 5, period: "noon", dayIndex: 13 },
  { year: 1, month: 5, period: "mid" }, // 缺 dayIndex
];

describe("gameTimeShape ≡ gameTimeSchema（防漂移）", () => {
  it("同样接受合法样本", () => {
    expect(gameTimeShape.safeParse(valid).success).toBe(true);
    expect(gameTimeSchema.safeParse(valid).success).toBe(true);
  });
  it("同样拒绝非法样本", () => {
    for (const bad of invalids) {
      expect(gameTimeShape.safeParse(bad).success).toBe(gameTimeSchema.safeParse(bad).success);
      expect(gameTimeShape.safeParse(bad).success).toBe(false);
    }
  });
});
