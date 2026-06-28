import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { firstNonEmpressConsortId } from "../helpers/consortFixture";

describe("新游戏 storehouse + affection 播种", () => {
  it("播种少量种子物品（id 均在目录内）", () => {
    const db = loadRealContent();
    const items = createNewGameState(db).resources.storehouse.items;
    const ids = Object.keys(items);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) expect(db.items[id]).toBeDefined();
  });

  it("侍君 affection 播种为其 hidden.affection", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const consortId = firstNonEmpressConsortId(db, state);
    const char = db.characters[consortId] ?? state.generatedConsorts[consortId];
    expect(state.standing[consortId]!.affection).toBe(char?.hidden!.affection);
  });
});
