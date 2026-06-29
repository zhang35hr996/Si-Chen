import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { maybeBuildRebukeForAction } from "../../src/store/taihouRebukeFlow";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

function hittingSeed(): string {
  const state = createNewGameState(db);
  for (let i = 0; i < 500; i++) {
    const seed = "greeting-gate:" + i;
    if (maybeBuildRebukeForAction(db, state, seed, "palace")) return seed;
  }
  throw new Error("no hitting seed found");
}

describe("太后训诫与问安礼互斥", () => {
  it("坤宁宫问安时段不并发生成训诫事件", () => {
    const state = createNewGameState(db);
    const seed = hittingSeed();
    state.playerLocation = "kunninggong";

    expect(maybeBuildRebukeForAction(db, state, seed, "hougong")).toBeNull();
  });
});
