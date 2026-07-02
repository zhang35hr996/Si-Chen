import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { maybeBuildRebukeForAction } from "../../src/store/taihouRebukeFlow";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

describe("问安礼与太后训诫互斥", () => {
  it("坤宁宫问安时段不创建第二个阻塞流程", () => {
    const state = createNewGameState(db);
    state.playerLocation = "kunninggong";

    for (let i = 0; i < 500; i++) {
      expect(maybeBuildRebukeForAction(db, state, "greeting:" + i, "hougong")).toBeNull();
    }
  });
});
