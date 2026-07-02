import { describe, expect, it } from "vitest";
import { bestowTargets } from "../../src/ui/components/BestowModal";
import { formatCoins } from "../../src/ui/format";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("库房展示辅助", () => {
  it("formatCoins 千分位", () => {
    expect(formatCoins(10000)).toBe("10,000");
    expect(formatCoins(3500000)).toBe("3,500,000");
  });
  it("bestowTargets 含在世侍君，宗亲为空", () => {
    const db = loadRealContent();
    const t = bestowTargets(db, createNewGameState(db));
    expect(t.consorts.length).toBeGreaterThan(0);
    expect(t.clan.length).toBe(0);
  });
  it("production-shaped runtime db lists each consort once (no duplicate keys)", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    // App merges generatedConsorts into db.characters; bestowTargets must not double-list.
    const runtimeDb = { ...db, characters: { ...db.characters, ...s.generatedConsorts } };
    const t = bestowTargets(runtimeDb, s);
    const ids = t.consorts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });
});
