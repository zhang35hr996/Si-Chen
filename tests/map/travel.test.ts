import { describe, expect, it } from "vitest";
import { buildTravelBatch, checkTravel } from "../../src/engine/map/travel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyBatch, applyCommand } from "../../src/engine/state/reducer";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db); // at zichendian, 6 AP

const drainAp = (state: GameState, amount: number): GameState => {
  const r = applyCommand(state, { type: "SPEND_AP", amount });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.state;
};

describe("checkTravel", () => {
  it("allows a connected destination at zero AP cost (宫内移动免行动力)", () => {
    const r = checkTravel(db, fresh(), "yuhuayuan");
    expect(r).toEqual({ ok: true, value: { to: "yuhuayuan", costAp: 0 } });
  });

  it("rejects the current location and unknown ids", () => {
    expect(checkTravel(db, fresh(), "zichendian")).toMatchObject({
      ok: false,
      error: { code: "ALREADY_THERE" },
    });
    expect(checkTravel(db, fresh(), "loc_ghost")).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_LOCATION" },
    });
  });

  it("free travel stays legal even with no AP left (出门串宫不耗点)", () => {
    const zero = { ...fresh(), calendar: { ...fresh().calendar, ap: 0 } };
    expect(checkTravel(db, zero, "yuhuayuan")).toEqual({
      ok: true,
      value: { to: "yuhuayuan", costAp: 0 },
    });
  });

  it("fast-travel: any travel node is reachable regardless of adjacency", () => {
    // From 紫宸殿 (palace zone) straight to 坤宁宫 (hougong zone) — no edge between them.
    expect(checkTravel(db, fresh(), "kunninggong")).toEqual({
      ok: true,
      value: { to: "kunninggong", costAp: 0 },
    });
  });

  it("refuses to travel to a free-view location (opened by UI, not dispatched)", () => {
    expect(checkTravel(db, fresh(), "changmengong")).toMatchObject({
      ok: false,
      error: { code: "NOT_TRAVELABLE" },
    });
    expect(checkTravel(db, fresh(), "xuanzhengdian")).toMatchObject({
      ok: false,
      error: { code: "NOT_TRAVELABLE" },
    });
  });
});

describe("buildTravelBatch + reducer", () => {
  it("moves the player without spending AP (no SPEND_AP command when free)", () => {
    const state = fresh();
    const batch = buildTravelBatch(db, state, "kunninggong");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.value).toEqual([{ type: "MOVE_TO_LOCATION", locationId: "kunninggong" }]);
    const result = applyBatch(state, batch.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.playerLocation).toBe("kunninggong");
    expect(result.value.state.calendar.ap).toBe(6);
    expect(result.value.rolledOver).toBe(false);
  });

  it("free travel never rolls the action-day, even on the last AP", () => {
    const state = drainAp(fresh(), 5); // 1 AP left
    const batch = buildTravelBatch(db, state, "yuhuayuan");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const result = applyBatch(state, batch.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rolledOver).toBe(false);
    expect(result.value.state.playerLocation).toBe("yuhuayuan");
    expect(result.value.state.calendar.ap).toBe(1);
  });

  it("refuses to build a batch for illegal travel", () => {
    expect(buildTravelBatch(db, fresh(), "zichendian").ok).toBe(false);
  });
});
