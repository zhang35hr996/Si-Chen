import { describe, expect, it } from "vitest";
import {
  tributeChance, ministerTributeChance, buildProvinceTribute, buildMinisterTribute,
} from "../../src/store/tribute";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("进贡概率", () => {
  it("中性 50 → 10；高属性更高；夹 [3,40]", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.productivity = 50; s.resources.nation.publicSupport = 50; s.resources.sovereign.prestige = 50;
    expect(tributeChance(s)).toBe(10);
    s.resources.nation.productivity = 100; s.resources.nation.publicSupport = 100; s.resources.sovereign.prestige = 100;
    expect(tributeChance(s)).toBe(25); // 10 + 0.1*150
    s.resources.nation.productivity = 0; s.resources.nation.publicSupport = 0; s.resources.sovereign.prestige = 0;
    expect(tributeChance(s)).toBe(3); // clamp floor
  });
  it("大臣进献随 忠心/贪腐/威望", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.ministerLoyalty = 50; s.resources.nation.corruption = 50; s.resources.sovereign.prestige = 50;
    expect(ministerTributeChance(s)).toBe(10);
  });
});

describe("进贡报告", () => {
  it("省贡命中时给非食物物品 + 两选项", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.productivity = 100; s.resources.nation.publicSupport = 100; s.resources.sovereign.prestige = 100;
    // 用确定性 seed 找一个命中的 key
    let prompt = null;
    for (let i = 0; i < 50 && !prompt; i++) prompt = buildProvinceTribute(db, s, `k${i}`);
    expect(prompt).not.toBeNull();
    expect(prompt!.speakerId).toBe("cheng_feng");
    expect(prompt!.choices.map((c) => c.action.type).sort()).toEqual(["gift", "stash"]);
    const itemId = (prompt!.choices[0]!.action as { itemId: string }).itemId;
    const food = ["点心", "茶饮", "珍味"];
    expect(food).not.toContain(db.items[itemId]!.category);
  });
  it("大臣进献命中具名官员 + 珍宝池；名册空不触发", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.ministerLoyalty = 100; s.resources.nation.corruption = 100; s.resources.sovereign.prestige = 100;
    let prompt = null;
    for (let i = 0; i < 50 && !prompt; i++) prompt = buildMinisterTribute(db, s, `m${i}`);
    expect(prompt).not.toBeNull();
    const itemId = (prompt!.choices[0]!.action as { itemId: string }).itemId;
    expect(["器玩", "珍禽异兽"]).toContain(db.items[itemId]!.category);
    const empty = { ...s, officials: {} };
    expect(buildMinisterTribute(db, empty, "m0")).toBeNull();
  });
});
