import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const makeStarted = (traceMode: "record" | "off" | "strict" = "record") => {
  const store = createGameStore({ traceMode });
  store.newGame(db);
  return store;
};

describe("GameStore trace integration", () => {
  it("records a trace transaction after applyEffects in 'record' mode", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 3 }]);
    const history = store.getTraceHistory();
    expect(history.size).toBeGreaterThanOrEqual(1);
    const tx = history.getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.source.kind).toBe("action");
    const favorMut = tx.mutations.find((m) => m.path === `standing.${firstChar}.favor`);
    expect(favorMut).toBeDefined();
    expect(favorMut?.delta).toBe(3);
  });

  it("records a rolled_back transaction when effects are rejected", () => {
    const store = makeStarted("record");
    store.applyEffects(db, [{ type: "favor", char: "char_does_not_exist", delta: 3 }]);
    const history = store.getTraceHistory();
    expect(history.size).toBeGreaterThanOrEqual(1);
    const tx = history.getAll().at(-1)!;
    expect(tx.outcome).toBe("rolled_back");
  });

  it("produces no trace history in 'off' mode", () => {
    const store = makeStarted("off");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 3 }]);
    expect(store.getTraceHistory().size).toBe(0);
  });

  it("does not change game state outcome with tracing enabled vs disabled", () => {
    const char1 = Object.keys(makeStarted("off").getState().standing)[0]!;

    const storeOff = makeStarted("off");
    storeOff.applyEffects(db, [{ type: "favor", char: char1, delta: 5 }]);

    const storeRec = makeStarted("record");
    storeRec.applyEffects(db, [{ type: "favor", char: char1, delta: 5 }]);

    const favOff = storeOff.getState().standing[char1]?.favor;
    const favRec = storeRec.getState().standing[char1]?.favor;
    expect(favRec).toBe(favOff);
  });

  it("trace transaction captures gameTime from post-commit state calendar", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(typeof tx.gameTime).toBe("string");
    expect(tx.gameTime!.length).toBeGreaterThan(0);
  });

  it("ring buffer enforces capacity limit", () => {
    const store = createGameStore({ traceMode: "record", traceHistoryLimit: 3 });
    store.newGame(db);
    const firstChar = Object.keys(store.getState().standing)[0]!;
    for (let i = 0; i < 5; i++) {
      store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    }
    expect(store.getTraceHistory().size).toBe(3);
  });
});
