import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";

describe("物品目录 db.items", () => {
  it("装载真实 items.json，含螺子黛", () => {
    const db = loadRealContent();
    const it = db.items["luozidai"];
    expect(it).toBeDefined();
    expect(it!.name).toBe("螺子黛");
    expect(["common", "fine", "treasure", "marvel"]).toContain(it!.tier);
  });

  it("每个物品 id 唯一且 tags 为数组", () => {
    const db = loadRealContent();
    for (const item of Object.values(db.items)) {
      expect(Array.isArray(item.tags)).toBe(true);
      expect(item.id.length).toBeGreaterThan(0);
    }
  });
});
