import { describe, expect, it } from "vitest";
import { renderRankReaction } from "../../src/engine/characters/rankReaction";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("renderRankReaction", () => {
  it("promote substitutes the NEW rank's selfRef and name", () => {
    const r = renderRankReaction(db, "promote", db.ranks.jun!, undefined);
    expect(r.lines[0]).toContain("臣侍"); // 君's toPlayer[0]
    expect(r.memory).toContain("君");
  });
  it("grant_title substitutes the 封号", () => {
    const r = renderRankReaction(db, "grant_title", db.ranks.chenghui!, "婉");
    expect(r.memory).toContain("婉");
  });
  it("falls back to a generic line when content lacks reactions", () => {
    const bare = { ...db, world: { ...db.world, rankChangeReactions: undefined } };
    expect(renderRankReaction(bare as typeof db, "demote", db.ranks.chenghui!, undefined).lines.length).toBeGreaterThan(0);
  });
});
