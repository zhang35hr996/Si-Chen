import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import { buildTravelBatch, checkTravel } from "../../src/engine/map/travel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyBatch, applyCommand } from "../../src/engine/state/reducer";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db); // at yushufang, 5 AP

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

  it("rejects unconnected destinations", () => {
    // Synthetic 3-node line graph: a—b—c (a and c not connected).
    const loc = (id: string, connections: string[]) => ({
      id,
      name: id,
      description: "d",
      backgroundKey: `bg.${id}`,
      ambience: [],
      position: { x: 0.5, y: 0.5 },
      connections,
      travelCost: { ap: 1 },
    });
    const lineDb = {
      ...db,
      locations: {
        loc_a: loc("loc_a", ["loc_b"]),
        loc_b: loc("loc_b", ["loc_a", "loc_c"]),
        loc_c: loc("loc_c", ["loc_b"]),
      },
    } as ContentDB;
    const state = { ...fresh(), playerLocation: "loc_a" };
    expect(checkTravel(lineDb, state, "loc_c")).toMatchObject({
      ok: false,
      error: { code: "NOT_CONNECTED" },
    });
    expect(checkTravel(lineDb, state, "loc_b").ok).toBe(true);
  });
});

describe("buildTravelBatch + reducer", () => {
  it("moves the player and spends AP atomically", () => {
    const state = fresh();
    const batch = buildTravelBatch(db, state, "hougong_zhudian");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const result = applyBatch(state, batch.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.playerLocation).toBe("hougong_zhudian");
    expect(result.value.state.calendar.ap).toBe(4);
    expect(result.value.rolledOver).toBe(false);
  });

  it("travel on the last AP rolls the action-day", () => {
    let state = drainAp(fresh(), 4); // 1 AP left
    const batch = buildTravelBatch(db, state, "yuhuayuan");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const result = applyBatch(state, batch.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.value.state;
    expect(result.value.rolledOver).toBe(true);
    expect(state.playerLocation).toBe("yuhuayuan");
    expect(state.calendar).toMatchObject({ period: "mid", ap: 5 });
  });

  it("refuses to build a batch for illegal travel", () => {
    expect(buildTravelBatch(db, fresh(), "yushufang").ok).toBe(false);
  });
});
