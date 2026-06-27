import { describe, expect, it } from "vitest";
import { grantItem } from "../../src/store/treasury";
import { createInitialState } from "../../src/engine/state/initialState";

describe("treasury helpers", () => {
  it("grantItem 累加库存", () => {
    const s0 = createInitialState();
    const s1 = grantItem(grantItem(s0, "yulan_fen", 1), "yulan_fen", 2);
    expect(s1.resources.storehouse.items["yulan_fen"]).toBe(3);
  });
});
