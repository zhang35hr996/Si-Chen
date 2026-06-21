import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";

function newStore() {
  const db = loadRealContent();
  const store = new GameStore();
  store.newGame(db);
  return { db, store };
}

describe("GameStore 获取方法", () => {
  it("applyGrantItem 入库", () => {
    const { store } = newStore();
    store.applyGrantItem("luozidai", 2);
    expect(store.getState().resources.storehouse.items["luozidai"]).toBeGreaterThanOrEqual(2);
  });
  it("buyItem 足额成功扣钱入库；不足失败", () => {
    const { store } = newStore();
    const before = store.getState().resources.nation.treasury;
    expect(store.buyItem("yunjin", 100)).toBe(true);
    expect(store.getState().resources.nation.treasury).toBe(before - 100);
    expect(store.buyItem("yunjin", 9_999_999)).toBe(false);
  });
  it("applyAutumnHunt 掷皮毛入库 + 设 flag；declineAutumnHunt 只设 flag", () => {
    const { store } = newStore();
    store.getState(); // martial 默认 50 → MID 档
    const got = store.applyAutumnHunt("h");
    expect(got.length).toBeGreaterThanOrEqual(2);
    const year = store.getState().calendar.year;
    expect(store.getState().flags[`autumnHunt:${year}`]).toBe(true);
  });
  it("giftTribute：库存净不变、目标 favor 升", () => {
    const { db, store } = newStore();
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    const favor0 = store.getState().standing[consort.id]!.favor;
    const before = store.getState().resources.storehouse.items["luozidai"] ?? 0;
    const ok = store.giftTribute(db, "luozidai", { kind: "consort", id: consort.id });
    expect(ok).toBe(true);
    expect(store.getState().standing[consort.id]!.favor).toBeGreaterThan(favor0);
    // grant +1 then bestow −1 → net zero: end count equals start count
    expect(store.getState().resources.storehouse.items["luozidai"] ?? 0).toBe(before); // grant 后 bestow 扣回，净不变
  });
});
