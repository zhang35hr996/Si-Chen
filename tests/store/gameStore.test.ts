import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/engine/infra/logger";
import { createGameStore } from "../../src/store/gameStore";

describe("GameStore", () => {
  it("commits successful dispatches and notifies subscribers", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    const r = store.dispatch({ type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.ap).toBe(4);
    expect(notifications).toBe(1);
  });

  it("rejected dispatches change nothing, notify no one, and log the GameError", () => {
    const logger = createLogger({ now: () => 0 });
    const store = createGameStore({ logger });
    let notifications = 0;
    store.subscribe(() => notifications++);
    const before = store.getState();

    const r = store.dispatch({ type: "SPEND_AP", amount: 99 });
    expect(r.ok).toBe(false);
    expect(store.getState()).toBe(before); // same reference — nothing changed
    expect(notifications).toBe(0);
    expect(logger.entries()).toHaveLength(1);
    expect(logger.entries()[0]?.message).toContain("AP_INSUFFICIENT");
  });

  it("dispatchBatch is atomic through the store", () => {
    const store = createGameStore();
    const before = store.getState();
    const r = store.dispatchBatch([
      { type: "SET_FLAG", key: "x", value: 1 },
      { type: "SPEND_AP", amount: 99 },
    ]);
    expect(r.ok).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it("unsubscribe stops notifications; reset returns to a fresh initial state", () => {
    const store = createGameStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.dispatch({ type: "SET_FLAG", key: "a", value: true });
    unsubscribe();
    store.dispatch({ type: "SET_FLAG", key: "b", value: true });
    expect(notifications).toBe(1);

    store.reset();
    expect(store.getState().flags).toEqual({});
    expect(store.getState().calendar.ap).toBe(5);
  });
});
