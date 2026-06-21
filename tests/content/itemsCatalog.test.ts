import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";

describe("物品目录覆盖", () => {
  it("含各类别代表物且 tier 合理", () => {
    const db = loadRealContent();
    const byName = Object.fromEntries(Object.values(db.items).map((i) => [i.name, i]));
    expect(byName["银狼皮"]?.tier).toBe("marvel");
    expect(byName["兔毛"]?.tier).toBe("common");
    expect(byName["御制龙香墨"]?.tier).toBe("marvel");
    expect(byName["古籍孤本"]?.tags).toContain("古籍");
    expect(byName["云锦"]?.category).toBe("绸缎");
    expect(byName["梅花糕"]?.category).toBe("点心");
    expect(byName["明前龙井"]?.category).toBe("茶饮");
  });

  it("物品总数达到目录规模（≥150）", () => {
    expect(Object.keys(loadRealContent().items).length).toBeGreaterThanOrEqual(150);
  });
});
