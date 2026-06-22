import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/engine/infra/logger";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";

describe("GameStore", () => {
  it("commits successful dispatches and notifies subscribers", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    const r = store.dispatch({ type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.ap).toBe(5);
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
    expect(store.getState().calendar.ap).toBe(6);
  });
});

describe("GameStore.commitDialogueState", () => {
  it("returns true and updates state when expected matches", () => {
    const store = createGameStore();
    const expected = store.getState();
    // Build a "next" state that differs from expected
    const next: GameState = { ...expected, flags: { dialogue_committed: true } };

    let notifications = 0;
    store.subscribe(() => notifications++);

    const result = store.commitDialogueState(expected, next);
    expect(result).toBe(true);
    expect(store.getState()).toBe(next);
    expect(store.getState().flags.dialogue_committed).toBe(true);
    expect(notifications).toBe(1); // subscribers notified
  });

  it("returns false and does NOT update when expected differs (CAS)", () => {
    const store = createGameStore();
    const expected = store.getState();

    // Mutate state so it no longer matches expected
    store.dispatch({ type: "SET_FLAG", key: "interim", value: true });
    const current = store.getState();
    expect(current).not.toBe(expected);

    const next: GameState = { ...current, flags: { ...current.flags, dialogue_committed: true } };

    let notifications = 0;
    store.subscribe(() => notifications++);

    // CAS should fail because store.state !== expected
    const result = store.commitDialogueState(expected, next);
    expect(result).toBe(false);
    expect(store.getState()).toBe(current); // unchanged
    expect(notifications).toBe(0); // no notification
  });

  it("CAS: snapshot before async op matches → commit succeeds", () => {
    const store = createGameStore();
    // Simulate: take snapshot, do async op, then commit
    const snapshot = store.getState();
    // No state changes happened in between → CAS succeeds
    const next: GameState = { ...snapshot, flags: { async_result: true } };
    const committed = store.commitDialogueState(snapshot, next);
    expect(committed).toBe(true);
    expect(store.getState().flags.async_result).toBe(true);
  });

  it("CAS: state changed during async op → commit fails (DIALOGUE_STATE_STALE)", () => {
    const store = createGameStore();
    const snapshot = store.getState();
    // Simulate state change racing with async dialogue call
    store.dispatch({ type: "SPEND_AP", amount: 1 });
    // Now try to commit with old snapshot
    const next: GameState = { ...snapshot, flags: { async_result: true } };
    const committed = store.commitDialogueState(snapshot, next);
    expect(committed).toBe(false); // race detected
    expect(store.getState().flags.async_result).toBeUndefined(); // stale result discarded
  });
});
