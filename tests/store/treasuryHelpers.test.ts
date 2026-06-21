import { describe, expect, it } from "vitest";
import { grantCoins, spendCoins, grantItem } from "../../src/store/treasury";
import { createInitialState } from "../../src/engine/state/initialState";

describe("treasury helpers", () => {
  it("grantCoins 累加，不改入参", () => {
    const s0 = createInitialState();
    const s1 = grantCoins(s0, 500);
    expect(s1.resources.nation.treasury).toBe(10500);
    expect(s0.resources.nation.treasury).toBe(10000);
  });

  it("spendCoins 足额成功、不足失败", () => {
    const s0 = createInitialState();
    const ok = spendCoins(s0, 3000);
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.state.resources.nation.treasury).toBe(7000);
    expect(spendCoins(s0, 99999).ok).toBe(false);
  });

  it("grantItem 累加库存", () => {
    const s0 = createInitialState();
    const s1 = grantItem(grantItem(s0, "yulan_fen", 1), "yulan_fen", 2);
    expect(s1.resources.storehouse.items["yulan_fen"]).toBe(3);
  });
});
