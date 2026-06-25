/**
 * Tests for PR7A deprecated rank assignment policy.
 *
 * Policy:
 *  - Characters who already hold a deprecated rank can still be read/displayed
 *  - They can be PROMOTED out of a deprecated rank
 *  - NO new assignment to a deprecated rank (via buildRankOp, funnel, UI ladder)
 *  - isAssignableRank() is the single canonical gate
 */
import { describe, expect, it } from "vitest";
import { isAssignableRank } from "../../src/engine/content/schemas";
import { buildRankOp } from "../../src/store/rankOps";
import { loadRealContent } from "../helpers/contentFixture";
import { createGameStore } from "../../src/store/gameStore";
import { createLogger } from "../../src/engine/infra/logger";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

describe("isAssignableRank", () => {
  it("guannanzi is not assignable (deprecated=true)", () => {
    const rank = db.ranks["guannanzi"]!;
    expect(isAssignableRank(rank)).toBe(false);
  });

  it("gengyi (更衣, lowest canonical) is assignable", () => {
    const rank = db.ranks["gengyi"]!;
    expect(isAssignableRank(rank)).toBe(true);
  });

  it("all ranks in world.json are either assignable or explicitly deprecated", () => {
    for (const rank of Object.values(db.ranks)) {
      expect(typeof rank.deprecated).toBe("boolean");
      // isAssignableRank is the inverse of deprecated
      expect(isAssignableRank(rank)).toBe(!rank.deprecated);
    }
  });
});

describe("buildRankOp rejects deprecated rank targets", () => {
  function makeState(rank: string): GameState {
    const store = createGameStore({ logger: createLogger({ now: () => 0 }) });
    store.newGame(db);
    const state = store.getState();
    // Patch lu_huaijin's rank to a known starting point
    const lu = state.standing["lu_huaijin"];
    if (!lu) throw new Error("lu_huaijin not found");
    return {
      ...state,
      standing: {
        ...state.standing,
        lu_huaijin: { ...lu, rank },
      },
    };
  }

  it("buildRankOp returns null when target is a deprecated rank", () => {
    // Start at 更衣 (gengyi) — guannanzi (order 40) would be a demotion target but is deprecated
    const state = makeState("gengyi");
    const authority = { kind: "sovereign", actorId: "player" } as const;
    const result = buildRankOp(db, state, "lu_huaijin", { kind: "set_rank", rank: "guannanzi" }, authority);
    expect(result).toBeNull();
  });

  it("buildRankOp allows promotion to a non-deprecated rank", () => {
    const state = makeState("gengyi");
    const authority = { kind: "sovereign", actorId: "player" } as const;
    const result = buildRankOp(db, state, "lu_huaijin", { kind: "set_rank", rank: "daying" }, authority);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("promote");
  });
});

describe("DECREE_RANK_FLOOR excludes deprecated rank", () => {
  it("band ranks used by empress decree do not include guannanzi", async () => {
    const { adjacentHaremRank } = await import("../../src/store/empressDecree");
    // Start at gengyi (order=50); adjacentHaremRank demote should return null
    // (no lower assignable rank in the band), not guannanzi
    const result = adjacentHaremRank(db, "gengyi", "demote");
    expect(result).toBeNull(); // guannanzi (order 40) is excluded
  });

  it("adjacentHaremRank promote from gengyi returns daying (not null)", async () => {
    const { adjacentHaremRank } = await import("../../src/store/empressDecree");
    const result = adjacentHaremRank(db, "gengyi", "promote");
    expect(result).toBe("daying"); // 答应 is the next rank above 更衣
  });
});

describe("canAdministratorAdjustRank rejects deprecated target rank", () => {
  it("canAdministratorAdjustRank returns ok=false when newRankId is deprecated", async () => {
    const { canAdministratorAdjustRank } = await import("../../src/engine/characters/haremRankAuthority");
    const store = createGameStore({ logger: createLogger({ now: () => 0 }) });
    store.newGame(db);
    // lu_huaijin needs rank ≥ 驸 (order=140) to exercise admin authority; bump to 驸
    const base = store.getState();
    const lu = base.standing["lu_huaijin"]!;
    const state: GameState = {
      ...base,
      standing: { ...base.standing, lu_huaijin: { ...lu, rank: "fu" } },
      haremAdministration: {
        mode: "acting_consort",
        charId: "lu_huaijin",
        appointedAt: base.calendar,
        reason: "empress_illness" as const,
      },
    };
    // xu_qinghuan must have rank strictly below lu_huaijin (驸=140)
    const xu = state.standing["xu_qinghuan"];
    if (!xu || db.ranks[xu.rank]!.order >= 140) return; // skip if target not below actor
    const result = canAdministratorAdjustRank(db, state, "lu_huaijin", "xu_qinghuan", "guannanzi");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("废弃");
  });
});
