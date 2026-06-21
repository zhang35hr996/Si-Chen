import { describe, expect, it } from "vitest";
import { priceOf, shopShelf } from "../../src/store/shop";
import { loadRealContent } from "../helpers/contentFixture";

describe("商铺定价", () => {
  it("按 tier 落区间且 ∈[10,500]", () => {
    const db = loadRealContent();
    const ranges: Record<string, [number, number]> = {
      common: [10, 50], fine: [50, 150], treasure: [150, 350], marvel: [350, 500],
    };
    for (const item of Object.values(db.items)) {
      const p = priceOf(item, "s");
      const [lo, hi] = ranges[item.tier]!;
      expect(p).toBeGreaterThanOrEqual(lo);
      expect(p).toBeLessThanOrEqual(hi);
      expect(p).toBeGreaterThanOrEqual(10);
      expect(p).toBeLessThanOrEqual(500);
    }
  });
  it("priceOf 确定性", () => {
    const db = loadRealContent();
    const item = Object.values(db.items)[0]!;
    expect(priceOf(item, "k")).toBe(priceOf(item, "k"));
  });
  it("marvel 价格可达区间上部（>449）", () => {
    const db = loadRealContent();
    const marvel = Object.values(db.items).find((i) => i.tier === "marvel")!;
    let max = 0;
    for (let i = 0; i < 200; i++) max = Math.max(max, priceOf(marvel, `seed${i}`));
    expect(max).toBeGreaterThanOrEqual(450);
  });
});

describe("货架轮替", () => {
  it("万宝楼只上非食物；6–10 件；同旬稳定，跨旬变化", () => {
    const db = loadRealContent();
    const food = ["点心", "茶饮", "珍味"];
    const shelf = shopShelf(db, "wanbaolou", 100, 1);
    expect(shelf.length).toBeGreaterThanOrEqual(6);
    expect(shelf.length).toBeLessThanOrEqual(10);
    for (const id of shelf) expect(food).not.toContain(db.items[id]!.category);
    expect(shopShelf(db, "wanbaolou", 100, 1)).toEqual(shelf); // 同参数稳定
    expect(shopShelf(db, "wanbaolou", 101, 1)).not.toEqual(shelf); // 跨旬变化（极大概率）
  });
  it("醉仙楼只上食物", () => {
    const db = loadRealContent();
    const food = ["点心", "茶饮", "珍味"];
    for (const id of shopShelf(db, "zuixianlou", 100, 1)) expect(food).toContain(db.items[id]!.category);
  });
});
