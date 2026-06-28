/**
 * Tests for deprecated rank assignment policy.
 *
 * Policy:
 *  - Characters who already hold a deprecated rank can still be read/displayed
 *  - They can be PROMOTED out of a deprecated rank
 *  - NO new assignment to a deprecated rank (via buildRankOp, funnel, UI ladder)
 *  - isAssignableRank() is the single canonical gate
 *
 * With the 称谓系统权威化 (address system canonicalization), guannanzi (观南子)
 * is now an ACTIVE rank — not deprecated. This test reflects that.
 */
import { describe, expect, it } from "vitest";
import { isAssignableRank } from "../../src/engine/content/schemas";
import { buildRankOp } from "../../src/store/rankOps";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import { createGameStore } from "../../src/store/gameStore";
import { createLogger } from "../../src/engine/infra/logger";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

describe("isAssignableRank", () => {
  it("guannanzi is now active (not deprecated) and IS assignable", () => {
    const rank = db.ranks["guannanzi"]!;
    expect(isAssignableRank(rank)).toBe(true);
  });

  it("gengyi (更衣) is assignable", () => {
    const rank = db.ranks["gengyi"]!;
    expect(isAssignableRank(rank)).toBe(true);
  });

  it("xuanshi (选侍) is assignable", () => {
    const rank = db.ranks["xuanshi"]!;
    expect(isAssignableRank(rank)).toBe(true);
  });

  it("all ranks in world.json are either assignable or explicitly deprecated", () => {
    for (const rank of Object.values(db.ranks)) {
      expect(typeof rank.deprecated).toBe("boolean");
      expect(isAssignableRank(rank)).toBe(!rank.deprecated);
    }
  });

  it("a synthetic rank with deprecated:true is not assignable", () => {
    const fakeRank = { ...db.ranks["guannanzi"]!, deprecated: true };
    expect(isAssignableRank(fakeRank)).toBe(false);
  });
});

describe("buildRankOp rejects deprecated rank targets", () => {
  function makeState(rank: string): GameState {
    const store = createGameStore({ logger: createLogger({ now: () => 0 }) });
    store.newGame(db);
    const base = store.getState();
    const state = withConsort(base, db, "lu_huaijin");
    const lu = state.standing["lu_huaijin"]!;
    return {
      ...state,
      standing: {
        ...state.standing,
        lu_huaijin: { ...lu, rank },
      },
    };
  }

  it("buildRankOp allows promotion to guannanzi (now active)", () => {
    // Start at a rank below guannanzi for demotion/promotion scenarios
    const state = makeState("xuanshi");
    const authority = { kind: "sovereign", actorId: "player" } as const;
    const result = buildRankOp(db, state, "lu_huaijin", { kind: "set_rank", rank: "guannanzi" }, authority);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("demote");
  });

  it("buildRankOp allows promotion to non-deprecated rank", () => {
    const state = makeState("gengyi");
    const authority = { kind: "sovereign", actorId: "player" } as const;
    const result = buildRankOp(db, state, "lu_huaijin", { kind: "set_rank", rank: "daying" }, authority);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("promote");
  });
});

describe("DECREE_RANK_FLOOR — adjacentHaremRank band", () => {
  it("adjacentHaremRank demote from gengyi → xuanshi (new rank below gengyi)", async () => {
    const { adjacentHaremRank } = await import("../../src/store/empressDecree");
    const result = adjacentHaremRank(db, "gengyi", "demote");
    expect(result).toBe("xuanshi");
  });

  it("adjacentHaremRank demote from xuanshi → guannanzi", async () => {
    const { adjacentHaremRank } = await import("../../src/store/empressDecree");
    const result = adjacentHaremRank(db, "xuanshi", "demote");
    expect(result).toBe("guannanzi");
  });

  it("adjacentHaremRank demote from guannanzi → null (lowest in band)", async () => {
    const { adjacentHaremRank } = await import("../../src/store/empressDecree");
    const result = adjacentHaremRank(db, "guannanzi", "demote");
    expect(result).toBeNull();
  });

  it("adjacentHaremRank promote from gengyi returns daying (答应)", async () => {
    const { adjacentHaremRank } = await import("../../src/store/empressDecree");
    const result = adjacentHaremRank(db, "gengyi", "promote");
    expect(result).toBe("daying");
  });
});
