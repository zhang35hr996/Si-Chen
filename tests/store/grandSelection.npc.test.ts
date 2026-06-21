import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, npcKeepOnDelegate, npcKeepOnLeave, recommendRank } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("npcKeepOnDelegate", () => {
  it("返回 0 或 1–2 位，位分按家世推荐，确定性", () => {
    const s = createNewGameState(db);
    const kept = npcKeepOnDelegate(db, s, 1);
    expect(kept.length).toBeLessThanOrEqual(2);
    for (const k of kept) expect(k.rank).toBe(recommendRank(k.candidate.grade));
    expect(npcKeepOnDelegate(db, s, 1).map((k) => k.candidate.content.id)).toEqual(
      kept.map((k) => k.candidate.content.id),
    );
  });
});

describe("npcKeepOnLeave", () => {
  it("从剩余者取 0 或 1 位（确定性）", () => {
    const s = createNewGameState(db);
    const remaining = generateCandidates(db, s, 1).slice(2);
    const a = npcKeepOnLeave(remaining, s, 1);
    const b = npcKeepOnLeave(remaining, s, 1);
    expect(a?.candidate.content.id).toBe(b?.candidate.content.id);
    if (a) expect(remaining.some((c) => c.content.id === a.candidate.content.id)).toBe(true);
  });
  it("剩余为空 → null", () => {
    const s = createNewGameState(db);
    expect(npcKeepOnLeave([], s, 1)).toBeNull();
  });
});
