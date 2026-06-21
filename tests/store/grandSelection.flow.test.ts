import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, recommendRank, pickableRanks, describeRaiseHead } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("殿选流程依赖的不变量", () => {
  it("每位候选都能算出皇后推荐位分，且该位分在可选列表内", () => {
    const s = createNewGameState(db);
    const cands = generateCandidates(db, s, 1);
    const pickable = new Set(pickableRanks(db).map((r) => r.id));
    for (const c of cands) {
      const rec = recommendRank(c.grade);
      expect(pickable.has(rec)).toBe(true);
      expect(describeRaiseHead(c.content).length).toBeGreaterThan(0);
    }
  });
});
