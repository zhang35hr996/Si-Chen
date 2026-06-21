import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

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
    const st = createNewGameState(db).standing;
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    expect(st[consort.id]!.affection).toBe(consort.hidden!.affection);
  });
});
