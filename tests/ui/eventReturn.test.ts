/**
 * EventReturnTarget 生命周期（Commit B）。测试 App 实际使用的纯模块（resolveReturnNavigation
 * + navReducer），不复制 target 字面量、不渲染 App。
 */
import { describe, expect, it } from "vitest";
import {
  type EventReturnTarget,
  type NavAction,
  type NavState,
  canChain,
  initialNavState,
  navReducer,
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
  it("1. map target → map", () => {
    expect(resolveReturnNavigation({ kind: "map" })).toEqual({ view: "map" });
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
    expect(restore(s).nav).toEqual({ view: "map" });
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
