import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { gameStateSchema } from "../../src/engine/save/stateSchema";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("settledHeirUpbringingMonths persistence", () => {
  it("新档默认空数组", () => {
    const s = createNewGameState(db);
    expect(s.settledHeirUpbringingMonths).toEqual([]);
  });

  it("旧档缺字段可读（schema 默认补 []）", () => {
    const s = createNewGameState(db) as unknown as Record<string, unknown>;
    delete s.settledHeirUpbringingMonths;
    const parsed = gameStateSchema.safeParse(s);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settledHeirUpbringingMonths).toEqual([]);
  });

  it("round-trip 保持月键一致", () => {
    const s = createNewGameState(db);
    s.settledHeirUpbringingMonths = ["8:01", "8:02", "8:03"];
    const parsed = gameStateSchema.safeParse(s);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settledHeirUpbringingMonths).toEqual(["8:01", "8:02", "8:03"]);
  });
});
