import { describe, expect, it } from "vitest";
import { renderRankReaction } from "../../src/engine/characters/rankReaction";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("renderRankReaction — sovereign (emperor)", () => {
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
  it("sovereign promote line mentions 陛下, not acting consort phrases", () => {
    const r = renderRankReaction(db, "promote", db.ranks.fu!, undefined, { kind: "sovereign" });
    expect(r.lines.join("")).toContain("陛下");
    expect(r.lines.join("")).not.toContain("协理六宫");
  });
});

describe("renderRankReaction — empress (harem_administrator/empress)", () => {
  it("empress promote line does NOT contain 陛下", () => {
    const r = renderRankReaction(db, "promote", db.ranks.fu!, undefined, {
      kind: "harem_administrator", office: "empress",
    });
    expect(r.lines.join("")).not.toContain("陛下");
  });
  it("empress promote memory mentions 凤后, not 陛下", () => {
    const r = renderRankReaction(db, "promote", db.ranks.fu!, undefined, {
      kind: "harem_administrator", office: "empress",
    });
    expect(r.memory).toContain("凤后");
    expect(r.memory).not.toContain("陛下");
  });
  it("empress demote line does NOT contain 陛下", () => {
    const r = renderRankReaction(db, "demote", db.ranks.chenghui!, undefined, {
      kind: "harem_administrator", office: "empress",
    });
    expect(r.lines.join("")).not.toContain("陛下");
  });
  it("empress falls back when world.administratorRankChangeReactions absent", () => {
    const bare = { ...db, world: { ...db.world, administratorRankChangeReactions: undefined } };
    const r = renderRankReaction(bare as typeof db, "promote", db.ranks.fu!, undefined, {
      kind: "harem_administrator", office: "empress",
    });
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines.join("")).not.toContain("陛下");
  });
});

describe("renderRankReaction — acting consort (harem_administrator/acting_consort)", () => {
  it("acting consort promote line does NOT contain 陛下 or 谢陛下隆恩", () => {
    const r = renderRankReaction(db, "promote", db.ranks.fu!, undefined, {
      kind: "harem_administrator", office: "acting_consort",
    });
    expect(r.lines.join("")).not.toContain("陛下");
    expect(r.lines.join("")).not.toContain("谢陛下隆恩");
  });
  it("acting consort promote line mentions 协理六宫", () => {
    const r = renderRankReaction(db, "promote", db.ranks.fu!, undefined, {
      kind: "harem_administrator", office: "acting_consort",
    });
    expect(r.lines.join("")).toContain("协理六宫");
  });
  it("acting consort strip_title line does NOT contain 陛下", () => {
    const r = renderRankReaction(db, "strip_title", db.ranks.chenghui!, undefined, {
      kind: "harem_administrator", office: "acting_consort",
    });
    expect(r.lines.join("")).not.toContain("陛下");
  });
  it("acting consort memory uses 协理六宫者 not 陛下", () => {
    const r = renderRankReaction(db, "promote", db.ranks.fu!, undefined, {
      kind: "harem_administrator", office: "acting_consort",
    });
    expect(r.memory).not.toContain("陛下");
    expect(r.memory).toContain("协理六宫者");
  });
});
