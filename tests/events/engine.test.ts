import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import { getEligibleEvents, pickNextEvent } from "../../src/engine/events/engine";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db); // at yushufang

const at = (locationId: string): GameState => ({ ...fresh(), playerLocation: locationId });

describe("eligibility", () => {
  it("each slice event is eligible exactly at its own location", () => {
    expect(getEligibleEvents(db, at("yushufang"), "location_enter").map((e) => e.event.id)).toEqual([
      "ev_menses_rite",
    ]);
    expect(getEligibleEvents(db, at("yuhuayuan"), "location_enter").map((e) => e.event.id)).toEqual([
      "ev_shen_neglect",
    ]);
    expect(getEligibleEvents(db, at("hougong_zhudian"), "location_enter").map((e) => e.event.id)).toEqual([
      "ev_fenghou_rules",
    ]);
  });

  it("fired once-events drop out", () => {
    const state: GameState = {
      ...at("yushufang"),
      eventLog: [{ eventId: "ev_menses_rite", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
    };
    expect(getEligibleEvents(db, state, "location_enter")).toEqual([]);
  });

  it("affordability is flagged engine-side and pickNextEvent skips unaffordable", () => {
    const state = at("yushufang"); // rite costs 2 AP
    const broke: GameState = { ...state, calendar: { ...state.calendar, ap: 1 } };
    const eligible = getEligibleEvents(db, broke, "location_enter");
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.affordable).toBe(false); // surfaced as disabled, never started
    expect(pickNextEvent(db, broke, "location_enter")).toBeNull(); // and no auto time advance
  });
});

describe("priority, tiebreak, cooldown (synthetic events)", () => {
  const mkEvent = (patch: Partial<GameEventContent>): GameEventContent => ({
    id: "ev_x",
    title: "测试",
    sceneId: "sc_menses_rite",
    checkpoint: "location_enter",
    condition: { atLocation: "yushufang" },
    priority: 50,
    once: false,
    apCost: 1,
    ...patch,
  });

  const withEvents = (...events: GameEventContent[]): ContentDB =>
    ({ ...db, events: Object.fromEntries(events.map((e) => [e.id, e])) }) as ContentDB;

  it("highest priority wins; ties break by id ascending (deterministic)", () => {
    const testDb = withEvents(
      mkEvent({ id: "ev_b", priority: 50 }),
      mkEvent({ id: "ev_a", priority: 50 }),
      mkEvent({ id: "ev_c", priority: 90 }),
    );
    const ids = getEligibleEvents(testDb, fresh(), "location_enter").map((e) => e.event.id);
    expect(ids).toEqual(["ev_c", "ev_a", "ev_b"]);
    expect(pickNextEvent(testDb, fresh(), "location_enter")?.id).toBe("ev_c");
  });

  it("unaffordable top pick does not auto-advance; next affordable one is picked", () => {
    const testDb = withEvents(
      mkEvent({ id: "ev_heavy", priority: 90, apCost: 9 }),
      mkEvent({ id: "ev_light", priority: 50, apCost: 1 }),
    );
    expect(pickNextEvent(testDb, fresh(), "location_enter")?.id).toBe("ev_light");
  });

  it("cooldown holds for actionDays and releases on dayIndex", () => {
    const testDb = withEvents(mkEvent({ id: "ev_cd", cooldown: { actionDays: 2 } }));
    const fired: GameState = {
      ...fresh(),
      eventLog: [{ eventId: "ev_cd", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
    };
    expect(getEligibleEvents(testDb, fired, "location_enter")).toEqual([]); // day 0, cooling

    const later: GameState = {
      ...fired,
      calendar: { ...fired.calendar, period: "late", dayIndex: 2 }, // 元年一月下旬
    };
    expect(getEligibleEvents(testDb, later, "location_enter").map((e) => e.event.id)).toEqual(["ev_cd"]);
  });

  it("wrong checkpoint never matches", () => {
    expect(getEligibleEvents(db, fresh(), "game_start")).toEqual([]);
    expect(getEligibleEvents(db, fresh(), "time_advance")).toEqual([]);
  });
});
