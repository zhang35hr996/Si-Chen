import { describe, expect, it } from "vitest";
import { buildTravelBatch, checkTravel } from "../../src/engine/map/travel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyBatch, applyCommand } from "../../src/engine/state/reducer";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db); // at yushufang, 6 AP

const drainAp = (state: GameState, amount: number): GameState => {
  const r = applyCommand(state, { type: "SPEND_AP", amount });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.state;
};

describe("checkTravel", () => {
  it("allows a connected, affordable destination", () => {
    const r = checkTravel(db, fresh(), "yuhuayuan");
    expect(r).toEqual({ ok: true, value: { to: "yuhuayuan", costAp: 1 } });
  });

  it("rejects the current location, unknown ids, and unaffordable travel", () => {
    expect(checkTravel(db, fresh(), "yushufang")).toMatchObject({
      ok: false,
      error: { code: "ALREADY_THERE" },
    });
    expect(checkTravel(db, fresh(), "loc_ghost")).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_LOCATION" },
    });
    const broke = drainAp(drainAp(fresh(), 2), 2); // 1 AP left… travel cost 1 is fine; drain to 0:
    const zero = { ...broke, calendar: { ...broke.calendar, ap: 0 } };
    expect(checkTravel(db, zero, "yuhuayuan")).toMatchObject({
      ok: false,
      error: { code: "AP_INSUFFICIENT" },
    });
  });

  it("fast-travel: any travel node is reachable regardless of adjacency", () => {
    // From 御书房 (palace zone) straight to 坤宁宫 (hougong zone) — no edge between them.
    expect(checkTravel(db, fresh(), "kunninggong")).toEqual({
      ok: true,
      value: { to: "kunninggong", costAp: 1 },
    });
  });

  it("refuses to travel to a free-view location (opened by UI, not dispatched)", () => {
    expect(checkTravel(db, fresh(), "lenggong")).toMatchObject({
      ok: false,
      error: { code: "NOT_TRAVELABLE" },
    });
    expect(checkTravel(db, fresh(), "chaotang")).toMatchObject({
      ok: false,
      error: { code: "NOT_TRAVELABLE" },
    });
  });
});

describe("buildTravelBatch + reducer", () => {
  it("moves the player and spends AP atomically", () => {
    const state = fresh();
    const batch = buildTravelBatch(db, state, "kunninggong");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const result = applyBatch(state, batch.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.playerLocation).toBe("kunninggong");
    expect(result.value.state.calendar.ap).toBe(5);
    expect(result.value.rolledOver).toBe(false);
  });

  it("travel on the last AP rolls the action-day", () => {
    let state = drainAp(fresh(), 5); // 1 AP left
    const batch = buildTravelBatch(db, state, "yuhuayuan");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const result = applyBatch(state, batch.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value.state;
    expect(result.value.rolledOver).toBe(true);
    expect(state.playerLocation).toBe("yuhuayuan");
    expect(state.calendar).toMatchObject({ period: "mid", ap: 6 });
  });

  it("refuses to build a batch for illegal travel", () => {
    expect(buildTravelBatch(db, fresh(), "yushufang").ok).toBe(false);
  });
});
