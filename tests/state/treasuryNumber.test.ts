import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("treasury 纯数字铜钱", () => {
  it("初始 state treasury 为 10000", () => {
    expect(createInitialState().resources.nation.treasury).toBe(10000);
  });

  it("新游戏 state treasury 为 10000（取自 world.json）", () => {
    const db = loadRealContent();
    expect(createNewGameState(db).resources.nation.treasury).toBe(10000);
  });
});
