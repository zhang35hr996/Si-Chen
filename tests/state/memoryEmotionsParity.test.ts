import { describe, expect, it } from "vitest";
import { memoryEmotionsSchema as contentEmotions } from "../../src/engine/content/schemas";
import { memoryEmotionsSchema as saveEmotions } from "../../src/engine/save/stateSchema";

const valids = [
  {},
  { joy: 40 },
  { joy: 0, grief: 100 },
  { shame: 60, anger: 50, relief: 1 },
];
const invalids = [
  { joy: 101 }, // > 100
  { joy: -1 }, // < 0
  { rage: 10 }, // unknown emotion key
  { joy: "high" }, // non-numeric value
];

describe("memoryEmotionsSchema ≡ content/save（防漂移 + 加固）", () => {
  it("同样接受合法样本（0–100、键来自枚举）", () => {
    for (const ok of valids) {
      expect(contentEmotions.safeParse(ok).success).toBe(true);
      expect(saveEmotions.safeParse(ok).success).toBe(true);
    }
  });

  it("同样拒绝非法样本（越界 / 未知键 / 非数值）", () => {
    for (const bad of invalids) {
      expect(contentEmotions.safeParse(bad).success).toBe(saveEmotions.safeParse(bad).success);
      expect(contentEmotions.safeParse(bad).success).toBe(false);
    }
  });
});
