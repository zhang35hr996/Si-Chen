import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import {
  isDaxuanYear, daxuanAnnounceFlagKey, daxuanDianxuanFlagKey,
  recommendRank, initialFavorForRank, pickableRanks,
} from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("大选年判定", () => {
  it("元年/四年/七年为大选年；二三五六年不是", () => {
    expect([1, 4, 7, 10].map(isDaxuanYear)).toEqual([true, true, true, true]);
    expect([2, 3, 5, 6, 8].map(isDaxuanYear)).toEqual([false, false, false, false, false]);
  });
  it("flag key 拼接", () => {
    expect(daxuanAnnounceFlagKey(4)).toBe("daxuan:announce:4");
    expect(daxuanDianxuanFlagKey(4)).toBe("daxuan:dianxuan:4");
  });
});

describe("recommendRank 家世→位分", () => {
  it("按官品分档", () => {
    expect(recommendRank(18)).toBe("guiren");   // 正一品
    expect(recommendRank(17)).toBe("guiren");   // 从一品
    expect(recommendRank(16)).toBe("meiren");   // 正二品
    expect(recommendRank(13)).toBe("meiren");   // 从三品
    expect(recommendRank(12)).toBe("changzai"); // 正四品
    expect(recommendRank(9)).toBe("changzai");  // 从五品
    expect(recommendRank(8)).toBe("daying");    // 正六品
    expect(recommendRank(5)).toBe("daying");    // 从七品
    expect(recommendRank(4)).toBe("gengyi");    // 八品以下
    expect(recommendRank("commoner")).toBe("gengyi");
  });
});

describe("initialFavorForRank", () => {
  it("观南子 10、皇贵驸 20、中间线性、夹在 10–20", () => {
    expect(initialFavorForRank(50)).toBe(10);   // 更衣
    expect(initialFavorForRank(194)).toBe(20)  // 皇贵驸
    expect(initialFavorForRank(123)).toBe(15);  // 中点附近
    const v = initialFavorForRank(1000);        // 越界（皇后）仍夹住
    expect(v).toBeLessThanOrEqual(20);
    expect(v).toBeGreaterThanOrEqual(10);
  });
});

describe("pickableRanks", () => {
  it("含观南子与皇贵驸、不含皇后，降序", () => {
    const ranks = pickableRanks(db);
    const ids = ranks.map((r) => r.id);
    expect(ids).toContain("gengyi");
    expect(ids).toContain("huangguifu");
    expect(ids).not.toContain("huanghou");
    const orders = ranks.map((r) => r.order);
    expect(orders).toEqual([...orders].sort((a, b) => b - a));
  });
});
