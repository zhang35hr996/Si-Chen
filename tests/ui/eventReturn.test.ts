/**
 * EventReturnTarget 生命周期（Commit B）。测试 App 实际使用的纯模块（resolveReturnNavigation
 * + navReducer），不复制 target 字面量、不渲染 App。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AutoCheckpointRequest,
  type EventReturnTarget,
  type NavAction,
  type NavState,
  type PendingReactionCheckpoint,
  canChain,
  checkpointReturnTarget,
  eventSceneCompletionPlan,
  initialNavState,
  navReducer,
  pendingReactionReducer,
  rankAdminContinuation,
  firstNightRankDrainAction,
  resolveReturnNavigation,
} from "../../src/ui/eventReturn";

const run = (actions: NavAction[], from: NavState = initialNavState): NavState =>
  actions.reduce(navReducer, from);

/** 模拟一次恢复：快照当前 target → 导航 → consume 清空。返回导航与清空后的态。 */
const restore = (state: NavState) => {
  const target = state.target;
  const nav = target ? resolveReturnNavigation(target) : { view: "map" as const };
  return { nav, next: navReducer(state, { type: "consume" }) };
};

describe("resolveReturnNavigation destinations", () => {
  it("1. map target → map (root semantics by default)", () => {
    expect(resolveReturnNavigation({ kind: "map" })).toEqual({ view: "map", atRoot: true });
  });
  it("2. ordinary location → exact locationId", () => {
    expect(resolveReturnNavigation({ kind: "location", locationId: "yanhe_gong" })).toEqual({
      view: "location",
      locationId: "yanhe_gong",
    });
  });
  it("3. zichendian → 紫宸殿", () => {
    expect(resolveReturnNavigation({ kind: "zichendian" })).toMatchObject({ view: "zichendian", locationId: "zichendian" });
  });
  it("4. garden → retains subLocationId (host 御花园)", () => {
    expect(resolveReturnNavigation({ kind: "garden", subLocationId: "taiyechi" })).toEqual({
      view: "garden",
      locationId: "yuhuayuan",
      subLocationId: "taiyechi",
    });
  });
  it("5. xuanzhengdian → court location/view", () => {
    expect(resolveReturnNavigation({ kind: "xuanzhengdian" })).toMatchObject({ view: "xuanzhengdian", locationId: "xuanzhengdian" });
  });
});

describe("target lifecycle", () => {
  const loc: EventReturnTarget = { kind: "location", locationId: "yanhe_gong" };

  it("6. abandoned scene restores and consumes the target", () => {
    const started = run([{ type: "playerStart", target: loc }]);
    const { nav, next } = restore(started); // abandon path
    expect(nav).toEqual({ view: "location", locationId: "yanhe_gong" });
    expect(next.target).toBeNull();
  });

  it("7. committed final scene restores and consumes the target", () => {
    const started = run([{ type: "playerStart", target: { kind: "zichendian" } }]);
    const { nav, next } = restore(started);
    expect(nav).toMatchObject({ view: "zichendian" });
    expect(next.target).toBeNull();
  });

  it("8. scene_end chain inherits the target and does not consume it", () => {
    const s = run([{ type: "playerStart", target: loc }, { type: "chainAdvance" }]);
    expect(s.target).toEqual(loc);
    expect(s.chainDepth).toBe(1);
  });

  it("9. rollover time_advance chain also inherits the target", () => {
    const s = run([{ type: "playerStart", target: loc }, { type: "chainAdvance" }, { type: "chainAdvance" }]);
    expect(s.target).toEqual(loc);
    expect(s.chainDepth).toBe(2);
  });

  it("10. whole chain consumes the target exactly once", () => {
    let s = run([{ type: "playerStart", target: loc }, { type: "chainAdvance" }, { type: "chainAdvance" }]);
    expect(s.target).toEqual(loc); // still present through the chain
    const r = restore(s); // final restoration
    expect(r.nav).toEqual({ view: "location", locationId: "yanhe_gong" });
    s = r.next;
    expect(s.target).toBeNull(); // consumed once; nothing left to restore again
    expect(restore(s).nav).toEqual({ view: "map" }); // a second restore has no target → safe fallback
  });

  it("11. stale-target regression: A(zichendian) finishes, B(map) returns to map not zichendian", () => {
    let s = run([{ type: "playerStart", target: { kind: "zichendian" } }]);
    s = restore(s).next; // A finishes → target null
    expect(s.target).toBeNull();
    s = run([{ type: "playerStart", target: { kind: "map" } }], s); // B starts
    expect(restore(s).nav).toEqual({ view: "map", atRoot: true });
  });

  it("12. every player-start overwrites an existing (stale) target", () => {
    const s = run([
      { type: "playerStart", target: { kind: "zichendian" } },
      { type: "playerStart", target: { kind: "map" } }, // overwrite without consuming
    ]);
    expect(s.target).toEqual({ kind: "map" });
  });

  it("13. new game / load clears the target", () => {
    const s = run([{ type: "playerStart", target: loc }, { type: "clear" }]);
    expect(s.target).toBeNull();
    expect(s.chainDepth).toBe(0);
  });

  it("14. chain continuation does not reset the chain-depth budget; player-start does", () => {
    let s = run([{ type: "playerStart", target: loc }]);
    expect(s.chainDepth).toBe(0);
    s = run([{ type: "chainAdvance" }], s);
    expect(s.chainDepth).toBe(1);
    s = run([{ type: "chainAdvance" }], s);
    expect(s.chainDepth).toBe(2); // not reset
    expect(canChain(s)).toBe(true);
    s = run([{ type: "chainAdvance" }], s);
    expect(canChain(s)).toBe(false); // depth 3 → budget exhausted
    s = run([{ type: "playerStart", target: loc }], s);
    expect(s.chainDepth).toBe(0); // player-start resets
  });
});

describe("map board context across event return (regression)", () => {
  const jingcheng: EventReturnTarget = { kind: "map", atRoot: false, boardId: "jingcheng" };

  it("1. legacy/root {kind:'map'} resolves with root semantics", () => {
    const nav = resolveReturnNavigation({ kind: "map" });
    expect(nav.view).toBe("map");
    expect(nav.atRoot).toBe(true);
  });

  it("2. {kind:'map',atRoot:false,boardId:'jingcheng'} retains both fields", () => {
    expect(resolveReturnNavigation(jingcheng)).toEqual({ view: "map", atRoot: false, boardId: "jingcheng" });
  });

  it("3. consume still clears a map-context target", () => {
    const started = run([{ type: "playerStart", target: jingcheng }]);
    expect(navReducer(started, { type: "consume" }).target).toBeNull();
  });

  it("4. a stayOnMap chain retains the 京城 board through chainAdvance(s)", () => {
    const s = run([{ type: "playerStart", target: jingcheng }, { type: "chainAdvance" }, { type: "chainAdvance" }]);
    expect(s.target).toEqual(jingcheng);
    expect(resolveReturnNavigation(s.target!)).toMatchObject({ atRoot: false, boardId: "jingcheng" });
  });

  it("5. final restoration returns the same map context exactly once", () => {
    let s = run([{ type: "playerStart", target: jingcheng }, { type: "chainAdvance" }]);
    const r = restore(s);
    expect(r.nav).toEqual({ view: "map", atRoot: false, boardId: "jingcheng" });
    s = r.next;
    expect(s.target).toBeNull();
    expect(restore(s).nav).toEqual({ view: "map" }); // second restore: no target → safe root fallback
  });

  it("6. a later root-map player start overwrites the prior 京城 target", () => {
    const s = run([
      { type: "playerStart", target: jingcheng },
      { type: "playerStart", target: { kind: "map", atRoot: true } },
    ]);
    expect(s.target).toEqual({ kind: "map", atRoot: true });
  });
});

describe("checkpointReturnTarget — explicit board-id producer contract", () => {
  it("1. explicit 'jingcheng' board id → resumable map target", () => {
    expect(checkpointReturnTarget("jingcheng", "zichendian")).toEqual({ kind: "map", atRoot: false, boardId: "jingcheng" });
  });
  it("2. explicit 'jiaowai' board id preserved exactly", () => {
    expect(checkpointReturnTarget("jiaowai", "zichendian")).toEqual({ kind: "map", atRoot: false, boardId: "jiaowai" });
  });
  it("3. absent board id → location target for the current player location", () => {
    expect(checkpointReturnTarget(undefined, "yanhe_gong")).toEqual({ kind: "location", locationId: "yanhe_gong" });
  });
  it("6. helper does not accept/depend on a separate currentBoard snapshot (arity 2)", () => {
    expect(checkpointReturnTarget.length).toBe(2);
  });
});

describe("pending reaction checkpoint lifecycle (deferred-reaction desync fix)", () => {
  const stationary: AutoCheckpointRequest = { source: "stationary_rollover", returnTarget: { kind: "location", locationId: "zichendian" }, dispatch: "new_chain" };
  const board: AutoCheckpointRequest = { source: "stationary_rollover", returnTarget: { kind: "map", atRoot: false, boardId: "jingcheng" }, dispatch: "new_chain" };
  const begin = (request: AutoCheckpointRequest | null, from: PendingReactionCheckpoint = null) =>
    pendingReactionReducer(from, { type: "begin", request });

  it("1. non-rollover reaction (request null) produces NO pending checkpoint", () => {
    expect(begin(null)).toBeNull();
  });

  it("2. a later rollover request after a non-rollover is not contaminated by stale context", () => {
    const afterNonRollover = begin(null, { request: board }); // null clears any stale board context
    expect(afterNonRollover).toBeNull();
    expect(begin(stationary, afterNonRollover)).toEqual({ request: stationary }); // returns to location, never the stale board
  });

  it("3. rollover exit-palace request preserves the exact board return target", () => {
    expect(begin(board)).toEqual({ request: board });
  });

  it("4. rollover ordinary request stores the location return target", () => {
    expect(begin(stationary)).toEqual({ request: stationary });
  });

  it("5. consuming the pending context clears it exactly once", () => {
    const pending = begin(board);
    expect(pending!.request).toEqual(board); // captured for the one checkpoint run
    const afterConsume = pendingReactionReducer(pending, { type: "consume" });
    expect(afterConsume).toBeNull();
    expect(pendingReactionReducer(afterConsume, { type: "consume" })).toBeNull(); // idempotent; nothing left
  });

  it("6. starting a new reaction sequence overwrites any previous pending context", () => {
    const stale = begin(board);
    expect(begin(null, stale)).toBeNull(); // non-rollover overwrite clears
    expect(begin(stationary, stale)).toEqual({ request: stationary }); // rollover overwrite replaces
  });

  it("7. new game / load / death clearing removes the pending context", () => {
    expect(pendingReactionReducer(begin(board), { type: "clear" })).toBeNull();
  });
});

describe("first-night rank-admin checkpoint handoff", () => {
  const req: AutoCheckpointRequest = { source: "stationary_rollover", returnTarget: { kind: "location", locationId: "zichendian" }, dispatch: "new_chain" };
  const begin = (rolledOver: boolean, from: PendingReactionCheckpoint = null) =>
    pendingReactionReducer(from, { type: "begin", request: rolledOver ? req : null });

  // rollover first-night bedchamber → pending {request} awaiting handoff
  const rolloverFirstNightPending = () => begin(true);

  it("1. promotion → modal close flushes the pending checkpoint exactly once", () => {
    const pending = rolloverFirstNightPending();
    expect(pending).toEqual({ request: req });
    expect(rankAdminContinuation("first_night", "close")).toBe("flush_pending");
    // flush = consume once
    const afterFlush = pendingReactionReducer(pending, { type: "consume" });
    expect(afterFlush).toBeNull();
    expect(pendingReactionReducer(afterFlush, { type: "consume" })).toBeNull(); // not run twice
  });

  it("2. no-op rank result flushes the pending checkpoint", () => {
    expect(rankAdminContinuation("first_night", "no_op")).toBe("flush_pending");
  });

  it("3. failed applyEffects flushes the pending checkpoint", () => {
    expect(rankAdminContinuation("first_night", "failed")).toBe("flush_pending");
  });

  it("4. successful rank reaction defers flush to the reaction; reaction completion flushes once", () => {
    const pending = rolloverFirstNightPending();
    expect(rankAdminContinuation("first_night", "reaction_created")).toBe("defer_to_reaction");
    expect(pending).toEqual({ request: req }); // not flushed at rank-apply time
    // the resulting ReactionScreen.onDone flushes once
    expect(pendingReactionReducer(pending, { type: "consume" })).toBeNull();
  });

  it("5. normal rank-admin never flushes a rollover checkpoint on any outcome", () => {
    for (const outcome of ["close", "no_op", "failed", "reaction_created"] as const) {
      expect(rankAdminContinuation("normal", outcome)).toBe("none");
    }
  });

  it("6. first-night non-rollover begin clears any stale pending context", () => {
    expect(begin(false, { request: req })).toBeNull();
  });

  it("7. physician/child/adoption non-rollover begin also clears stale pending (unconditional begin)", () => {
    // all those paths now dispatch begin with their actual rolledOver; non-rollover ⇒ null
    expect(begin(false, { request: req })).toBeNull();
    expect(begin(true, { request: req })).toEqual({ request: req }); // rollover keeps a fresh ctx
  });
});

describe("firstNightRankDrainAction — queued decree reactions play before settlement flush", () => {
  // first-night close/no_op/failed with a non-empty reaction queue must play the queue first
  // (last reaction onDone flushes); an empty queue flushes immediately. reaction_created / normal defer.
  for (const outcome of ["close", "no_op", "failed"] as const) {
    it(`first_night + ${outcome}: queued reactions → play_queue (no premature flush)`, () => {
      expect(firstNightRankDrainAction("first_night", outcome, 2)).toBe("play_queue");
    });
    it(`first_night + ${outcome}: empty queue → flush_now`, () => {
      expect(firstNightRankDrainAction("first_night", outcome, 0)).toBe("flush_now");
    });
  }

  it("first_night + reaction_created → none (its reaction onDone flushes, regardless of queue)", () => {
    expect(firstNightRankDrainAction("first_night", "reaction_created", 2)).toBe("none");
    expect(firstNightRankDrainAction("first_night", "reaction_created", 0)).toBe("none");
  });

  it("normal origin → none on every outcome, even with a queue", () => {
    for (const outcome of ["close", "no_op", "failed", "reaction_created"] as const) {
      expect(firstNightRankDrainAction("normal", outcome, 3)).toBe("none");
    }
  });
});

describe("producer source contract (no jsdom)", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("MapScreen.exitPalace passes the literal destination board `to` through onTravelled", () => {
    const src = read("../../src/ui/screens/MapScreen.tsx");
    const start = src.indexOf("const exitPalace");
    const exitBody = src.slice(start, src.indexOf("};", start) + 2);
    // authoritative board id is the literal `to` (last arg), not a boolean or a mirrored parent snapshot
    expect(exitBody).toContain("onTravelled(");
    expect(exitBody).toMatch(/,\s*to\s*\)\s*;/);
    expect(exitBody).not.toMatch(/,\s*true\s*\)\s*;/); // old 4th-arg `true` is gone
  });

  // (runCheckpoints removed in the separate-rollover/arrival corrective; routing now covered by
  // settlement.test autoCheckpoint trigger tests + the "runCheckpoints gone" source assertion.)

  it("8. rank-admin session origin is bundled atomically and cleared on apply/close", () => {
    const src = read("../../src/ui/App.tsx");
    // single source of truth: { charId, origin } — no separate origin boolean
    expect(src).toMatch(/setRankAdmin\(\{ charId: id, origin: "first_night" \}\)/);
    expect(src).toMatch(/setRankAdmin\(\{ charId: id, origin: "normal" \}\)/);
    expect(src).toContain("setRankAdmin(null)"); // applyRankOp + modal close clear the session
    expect(src).not.toMatch(/setManageCharId/); // old independent state fully removed
  });

  it("9. new game / load / SettingsMenu load / death clear pending context AND rank-admin session", () => {
    const src = read("../../src/ui/App.tsx");
    // every nav clear site sits next to a pending clear and a rank-admin clear
    const navClears = src.match(/navDispatch\(\{ type: "clear" \}\)/g) ?? [];
    expect(navClears.length).toBeGreaterThanOrEqual(4);
    const pendingClears = src.match(/pendingReactionDispatch\(\{ type: "clear" \}\)/g) ?? [];
    expect(pendingClears.length).toBe(navClears.length);
    const rankClears = src.match(/setRankAdmin\(null\)/g) ?? [];
    // applyRankOp + modal close + 4 lifecycle sites
    expect(rankClears.length).toBeGreaterThanOrEqual(navClears.length);
  });
});

describe("eventSceneCompletionPlan (chained settlement + abandon)", () => {
  const plan = eventSceneCompletionPlan;

  it("1. abandoned event + no pending settlement → restore only", () => {
    expect(plan({ committed: false, rolledOver: false, hasSceneEndEvent: false, canChain: false, hasPendingSettlement: false }))
      .toEqual({ startSceneEnd: false, beginSettlement: false, restore: true });
  });
  it("2. abandoned chained event + existing pending settlement → no restore, no new settlement", () => {
    expect(plan({ committed: false, rolledOver: false, hasSceneEndEvent: false, canChain: false, hasPendingSettlement: true }))
      .toEqual({ startSceneEnd: false, beginSettlement: false, restore: false });
  });
  it("2b. abandoned event never creates a settlement even if (defensively) flagged rolledOver", () => {
    expect(plan({ committed: false, rolledOver: true, hasSceneEndEvent: true, canChain: true, hasPendingSettlement: false }).beginSettlement).toBe(false);
  });
  it("3. committed rollover + chainable scene_end → start scene_end, begin settlement, no restore", () => {
    expect(plan({ committed: true, rolledOver: true, hasSceneEndEvent: true, canChain: true, hasPendingSettlement: false }))
      .toEqual({ startSceneEnd: true, beginSettlement: true, restore: false });
  });
  it("4. committed non-rollover + existing pending + chainable scene_end → retain settlement, start scene_end, no restore", () => {
    expect(plan({ committed: true, rolledOver: false, hasSceneEndEvent: true, canChain: true, hasPendingSettlement: true }))
      .toEqual({ startSceneEnd: true, beginSettlement: true, restore: false });
  });
  it("5. committed terminal event + existing pending → no scene_end, retain settlement, no restore", () => {
    expect(plan({ committed: true, rolledOver: false, hasSceneEndEvent: false, canChain: true, hasPendingSettlement: true }))
      .toEqual({ startSceneEnd: false, beginSettlement: true, restore: false });
  });
  it("6. committed terminal event + no rollover/pending → restore immediately", () => {
    expect(plan({ committed: true, rolledOver: false, hasSceneEndEvent: false, canChain: true, hasPendingSettlement: false }))
      .toEqual({ startSceneEnd: false, beginSettlement: false, restore: true });
  });
  it("7. chain cap + existing pending → no scene_end, no restore before settlement", () => {
    expect(plan({ committed: true, rolledOver: false, hasSceneEndEvent: true, canChain: false, hasPendingSettlement: true }))
      .toEqual({ startSceneEnd: false, beginSettlement: true, restore: false });
  });
});

describe("abandon-after-rollover preserves the settlement target (consumed exactly once)", () => {
  // Simulate: A starts (playerStart), A commits+rolls over (chainAdvance to B + settlement registered),
  // B abandoned (plan says no restore → target NOT consumed), settlement completes (consume once).
  const sequence = (target: EventReturnTarget) => {
    let nav: NavState = navReducer(initialNavState, { type: "playerStart", target });
    // A commits + rolledOver + scene_end B eligible:
    const aPlan = eventSceneCompletionPlan({ committed: true, rolledOver: true, hasSceneEndEvent: true, canChain: canChain(nav), hasPendingSettlement: false });
    expect(aPlan).toMatchObject({ startSceneEnd: true, beginSettlement: true });
    nav = navReducer(nav, { type: "chainAdvance" }); // B starts; target retained
    // B abandoned, settlement already pending:
    const bPlan = eventSceneCompletionPlan({ committed: false, rolledOver: false, hasSceneEndEvent: false, canChain: false, hasPendingSettlement: true });
    expect(bPlan.restore).toBe(false); // do NOT consume here
    expect(nav.target).toEqual(target); // target still intact through abandon
    // settlement completes with no time event → restoreReturn consumes once:
    const before = nav.target;
    nav = navReducer(nav, { type: "consume" });
    expect(nav.target).toBeNull();
    return { before, after: nav.target };
  };

  it("ordinary palace target survives abandon and is consumed once at settlement", () => {
    const r = sequence({ kind: "location", locationId: "yanhe_gong" });
    expect(r.before).toEqual({ kind: "location", locationId: "yanhe_gong" });
    expect(r.after).toBeNull();
  });
  it("nested 京城/郊外 board target survives abandon and is consumed once at settlement", () => {
    const r = sequence({ kind: "map", atRoot: false, boardId: "jingcheng" });
    expect(r.before).toEqual({ kind: "map", atRoot: false, boardId: "jingcheng" });
    expect(r.after).toBeNull();
  });
});
