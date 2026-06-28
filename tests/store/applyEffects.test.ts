import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/engine/infra/logger";
import { createGameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";
import { activeEmpressId } from "../../src/engine/characters/empress";

const db = loadRealContent();

const makeStarted = () => {
  const logger = createLogger({ now: () => 0 });
  const store = createGameStore({ logger });
  store.newGame(db);
  return { store, logger };
};

describe("GameStore.applyEffects — the single gameplay-state entry point", () => {
  it("applied batch: new state reference, one notification, applied report", () => {
    const { store } = makeStarted();
    const before = store.getState();
    const empressId = activeEmpressId(store.getState())!;
    const empressFavorBefore = store.getState().standing[empressId]!.favor;
    let notifications = 0;
    store.subscribe(() => notifications++);

    const result = store.applyEffects(db, [
      { type: "favor", char: empressId, delta: 2 },
    ]);

    expect(result.ok).toBe(true);
    expect(store.getState()).not.toBe(before);
    expect(store.getState().standing[empressId]?.favor).toBe(empressFavorBefore + 2);
    expect(notifications).toBe(1);
    expect(store.getLastEffectReport()).toMatchObject({ outcome: "applied", errors: [] });
  });

  it("rejected batch: same state reference, zero notifications, every error logged once, rejected report", () => {
    const { store, logger } = makeStarted();
    const before = store.getState();
    const empressId = activeEmpressId(store.getState())!;
    let notifications = 0;
    store.subscribe(() => notifications++);

    const result = store.applyEffects(db, [
      { type: "favor", char: empressId, delta: 2 },
      { type: "favor", char: "char_ghost", delta: 2 },
    ]);

    expect(result.ok).toBe(false);
    expect(store.getState()).toBe(before); // atomic — untouched reference
    expect(notifications).toBe(0);
    expect(logger.entries()).toHaveLength(1); // exactly one log per collected error
    expect(logger.entries()[0]?.message).toContain("BAD_EFFECT_TARGET");
    expect(store.getLastEffectReport()?.outcome).toBe("rejected");
    expect(store.getLastEffectReport()?.errors).toHaveLength(1);
  });

  it("newGame clears the last effect report", () => {
    const { store } = makeStarted();
    store.applyEffects(db, [{ type: "flag", key: "x", value: 1 }]);
    expect(store.getLastEffectReport()).not.toBeNull();
    store.newGame(db);
    expect(store.getLastEffectReport()).toBeNull();
  });
});
