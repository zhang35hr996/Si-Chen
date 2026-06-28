/**
 * PR3 必修缺陷回归：物理在场唯一性（presentAt / consortLocationAt 是「此刻人在哪」的唯一权威；
 * getPresentAt 只是住处花名册）。同一 charId 在同一 calendar slot 中只能有一个物理位置，
 * 不得同时出现在御花园与寝殿、或请安地点与寝殿。
 */
import { describe, expect, it } from "vitest";
import { consortLocationAt, getPresentAt, presentAt } from "../../src/engine/characters/presence";
import { shichenSlot, MAO_SLOT } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();

/** Build a state at a given dayIndex/slot, with the sovereign somewhere that is NOT the test consort's home. */
const stateAt = (dayIndex: number, slot: number, playerLocation = "zichendian"): GameState => {
  const base = withConsort(createNewGameState(db), db, "lu_huaijin");
  return {
    ...base,
    playerLocation,
    calendar: { ...base.calendar, dayIndex, ap: base.calendar.apMax - slot },
  };
};

/** Find a (dayIndex, slot) where the given consort deterministically wanders to the garden. */
function findWanderingScenario(charId: string): { state: GameState; slot: number } {
  for (let dayIndex = 0; dayIndex < 200; dayIndex++) {
    for (let slot = 1; slot <= 3; slot++) {
      const state = stateAt(dayIndex, slot);
      if (consortLocationAt(db, state, charId, shichenSlot(state.calendar)) === "yuhuayuan") {
        return { state, slot };
      }
    }
  }
  throw new Error(`no wandering scenario found for ${charId}`);
}

const allLocationIds = Object.keys(db.locations);

/** Global physical-presence index: every present charId across all locations at this slot. */
function presenceIndex(state: GameState): string[] {
  return allLocationIds.flatMap((loc) => presentAt(db, state, loc).map((c) => c.id));
}

describe("physical presence is single-authority (presentAt), garden ≠ bedchamber", () => {
  it("1. a consort wandering to the garden is in presentAt(garden), not presentAt(home); the two sets are disjoint", () => {
    const { state } = findWanderingScenario("lu_huaijin");
    const home = "zhongcui_gong";
    const homeIds = new Set(presentAt(db, state, home).map((c) => c.id));
    const gardenIds = new Set(presentAt(db, state, "yuhuayuan").map((c) => c.id));
    expect(gardenIds.has("lu_huaijin")).toBe(true);
    expect(homeIds.has("lu_huaijin")).toBe(false);
    // disjoint
    for (const id of homeIds) expect(gardenIds.has(id)).toBe(false);
  });

  it("1b. her residence roster (getPresentAt) still lists her home even while she is away", () => {
    const { state } = findWanderingScenario("lu_huaijin");
    expect(getPresentAt(db, state, "zhongcui_gong").map((c) => c.id)).toContain("lu_huaijin");
  });

  it("5. global physical-presence index has each charId at most once (no duplication anywhere)", () => {
    const { state } = findWanderingScenario("lu_huaijin");
    const ids = presenceIndex(state);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("6. at 请安 (卯时), a non-excused consort is at 坤宁宫, not her home — same single-authority rule", () => {
    const state = stateAt(3, MAO_SLOT);
    expect(consortLocationAt(db, state, "lu_huaijin", MAO_SLOT)).toBe("kunninggong");
    expect(presentAt(db, state, "kunninggong").map((c) => c.id)).toContain("lu_huaijin");
    expect(presentAt(db, state, "zhongcui_gong").map((c) => c.id)).not.toContain("lu_huaijin");
    // still unique globally during greeting
    const ids = presenceIndex(state);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("7a. a deceased consort appears in no location's physical presence", () => {
    const { state } = findWanderingScenario("lu_huaijin");
    const dead: GameState = {
      ...state,
      standing: { ...state.standing, lu_huaijin: { ...state.standing.lu_huaijin!, lifecycle: "deceased" } },
    };
    expect(presenceIndex(dead)).not.toContain("lu_huaijin");
  });

  it("Blocker: garden→home transition — moving the player within the same slot does NOT teleport the NPC", () => {
    // 找到陆怀瑾游走御花园的 (day, slot)，玩家在紫宸殿。
    const { state } = findWanderingScenario("lu_huaijin");
    const home = "zhongcui_gong";
    // 同一 calendar slot，玩家零行动力移动到她的住处。
    const movedHome: GameState = { ...state, playerLocation: home };
    // 她必须仍在御花园，不能因玩家进她寝殿而被重算回宫。
    expect(consortLocationAt(db, movedHome, "lu_huaijin", shichenSlot(movedHome.calendar))).toBe("yuhuayuan");
    expect(presentAt(db, movedHome, home).map((c) => c.id)).not.toContain("lu_huaijin");
    expect(presentAt(db, movedHome, "yuhuayuan").map((c) => c.id)).toContain("lu_huaijin");
    // 全局唯一性仍成立。
    const ids = presenceIndex(movedHome);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("7b. a 冷宫(changmengong) resident never wanders to the garden", () => {
    // wenya lives in changmengong (cold palace)
    for (let dayIndex = 0; dayIndex < 60; dayIndex++) {
      for (let slot = 1; slot <= 3; slot++) {
        const state = stateAt(dayIndex, slot);
        expect(consortLocationAt(db, state, "wenya", shichenSlot(state.calendar))).not.toBe("yuhuayuan");
      }
    }
  });
});
