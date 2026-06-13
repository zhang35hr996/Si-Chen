import { describe, expect, it } from "vitest";
import type { EventEffect } from "../../src/engine/content/schemas";
import { hasEventFired } from "../../src/engine/events/conditions";
import { resolveEvent } from "../../src/engine/events/resolve";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createLogger } from "../../src/engine/infra/logger";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const atRite = (): GameState => createNewGameState(db); // yushufang; ev_menses_rite costs 1 AP (召对)

const riteEffects: EventEffect[] = [
  { type: "resource", pillar: "bloodline", field: "legitimacy", delta: 5 },
  { type: "flag", key: "rite_scheduled", value: true },
  {
    type: "memory",
    char: "sili_nvguan",
    entry: { kind: "event", summary: "祭仪已准。", salience: 60, tags: ["rite"], participants: ["player", "sili_nvguan"] },
  },
];

describe("resolveEvent — one transaction", () => {
  it("success: effects + AP spend + eventFired land together", () => {
    const result = resolveEvent(db, atRite(), "ev_menses_rite", riteEffects);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state, rolledOver } = result.value;
    expect(state.resources.bloodline.legitimacy).toBe(65);
    expect(state.flags["rite_scheduled"]).toBe(true);
    expect(state.memories["sili_nvguan"]?.entries).toHaveLength(2);
    expect(state.calendar.ap).toBe(4); // 5 - apCost 1
    expect(rolledOver).toBe(false);
    expect(hasEventFired(state, "ev_menses_rite")).toBe(true);
    expect(state.eventLog[0]?.firedAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(state.sceneHistory).toEqual(["sc_menses_rite"]); // committed in the same transaction
  });

  it("firedAt is stamped on the action-day it happened, even when apCost rolls the day", () => {
    const base = atRite();
    const state: GameState = { ...base, calendar: { ...base.calendar, ap: 1 } };
    const result = resolveEvent(db, state, "ev_menses_rite", []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rolledOver).toBe(true);
    expect(result.value.state.calendar).toMatchObject({ period: "mid", ap: 5 });
    expect(result.value.state.eventLog[0]?.firedAt.period).toBe("early"); // pre-rollover stamp
  });

  it("AP insufficient: blocked outright, no auto-rollover, nothing changes, NOT fired", () => {
    const base = atRite();
    const broke: GameState = { ...base, calendar: { ...base.calendar, ap: 0 } };
    const result = resolveEvent(db, broke, "ev_menses_rite", riteEffects);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.code).toBe("AP_INSUFFICIENT");
    expect(broke.calendar.ap).toBe(0);
    expect(broke.eventLog).toEqual([]);
  });

  it("rejected effects: NOT fired, no AP spent", () => {
    const state = atRite();
    const result = resolveEvent(db, state, "ev_menses_rite", [
      { type: "relationship", char: "char_ghost", field: "trust", delta: 2 },
    ]);
    expect(result.ok).toBe(false);
    expect(state.calendar.ap).toBe(5);
    expect(state.eventLog).toEqual([]);
  });

  it("once-event cannot resolve twice; unknown event refused", () => {
    const first = resolveEvent(db, atRite(), "ev_menses_rite", []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = resolveEvent(db, first.value.state, "ev_menses_rite", []);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error[0]?.code).toBe("EVENT_ALREADY_FIRED");

    const ghost = resolveEvent(db, atRite(), "ev_ghost", []);
    expect(ghost.ok).toBe(false);
  });
});

describe("store.resolveEvent commit semantics", () => {
  it("success notifies once; rejection keeps the reference, notifies no one, logs errors", () => {
    const logger = createLogger({ now: () => 0 });
    const store = createGameStore({ logger });
    store.newGame(db);
    let notifications = 0;
    store.subscribe(() => notifications++);

    const ok = store.resolveEvent(db, "ev_menses_rite", riteEffects);
    expect(ok.ok).toBe(true);
    expect(notifications).toBe(1);
    expect(store.getLastEffectReport()?.outcome).toBe("applied");

    const before = store.getState();
    const bad = store.resolveEvent(db, "ev_menses_rite", []); // once → already fired
    expect(bad.ok).toBe(false);
    expect(store.getState()).toBe(before);
    expect(notifications).toBe(1);
    expect(logger.entries().some((e) => e.message.includes("EVENT_ALREADY_FIRED"))).toBe(true);
    expect(store.getLastEffectReport()?.outcome).toBe("rejected");
  });
});
