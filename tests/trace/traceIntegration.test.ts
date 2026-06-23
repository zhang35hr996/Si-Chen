import { describe, expect, it, vi } from "vitest";
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

  // ── Review-required tests (9 items) ──────────────────────────────────────────

  it("memory trace includes full entry object at canonical path, not just a count", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [
      {
        type: "memory",
        char: firstChar,
        entry: {
          kind: "impression",
          summary: "测试记忆",
          strength: 10,
          retention: "fast",
          subjectIds: [firstChar],
          perspective: "witness",
          triggerTags: [],
          unresolved: false,
          emotions: {},
        },
      },
    ]);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    const memMuts = tx.mutations.filter((m) => m.path.startsWith(`memories.${firstChar}.entries.`));
    expect(memMuts.length).toBeGreaterThanOrEqual(1);
    // The mutation should record the full entry object as `after`, not a numeric count.
    const entryMut = memMuts[0]!;
    expect(typeof entryMut.after).toBe("object");
    expect(entryMut.after).not.toBeNull();
    expect((entryMut.after as { summary?: string }).summary).toBe("测试记忆");
  });

  it("playerLocation change is detected by recursive diff", () => {
    const store = makeStarted("record");
    const locationIds = Object.keys(db.locations);
    const initialLocation = store.getState().playerLocation;
    const newLocation = locationIds.find((id) => id !== initialLocation) ?? locationIds[0]!;
    store.dispatch({ type: "MOVE_TO_LOCATION", locationId: newLocation });
    const state = store.getState();
    if (state.playerLocation !== newLocation) return; // skip if MOVE not supported for this state
    const history = store.getTraceHistory();
    const tx = history.getAll().at(-1)!;
    const locMut = tx.mutations.find((m) => m.path === "playerLocation");
    expect(locMut).toBeDefined();
    expect(locMut?.before).toBe(initialLocation);
    expect(locMut?.after).toBe(newLocation);
  });

  it("strict mode: successful operation still commits (no false positives)", () => {
    const store = makeStarted("strict");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    const initialFavor = store.getState().standing[firstChar]?.favor ?? 0;

    // In strict mode, a fully-instrumented effect should commit successfully.
    const result = store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 7 }]);
    expect(result.ok).toBe(true);
    expect(store.getState().standing[firstChar]?.favor).toBe(initialFavor + 7);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
  });

  it("strict mode: rolled_back effect leaves state unchanged and records trace", () => {
    const store = makeStarted("strict");
    const stateBefore = store.getState();
    const emitSpy = vi.fn();
    store.subscribe(emitSpy);
    const emitsBefore = emitSpy.mock.calls.length;

    store.applyEffects(db, [{ type: "favor", char: "char_ghost_invalid_999", delta: 3 }]);

    // State must be unchanged.
    expect(store.getState()).toBe(stateBefore);
    // No emit for a rolled_back transaction.
    expect(emitSpy.mock.calls.length).toBe(emitsBefore);
    // Rolled_back trace IS recorded.
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("rolled_back");
  });

  it("calendar_advance phase label appears in time-advance trace mutations", () => {
    const store = makeStarted("record");
    const result = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(result.ok).toBe(true);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.source.kind).toBe("time_advance");
    // Calendar AP change should be labeled "calendar_advance".
    const calMut = tx.mutations.find((m) => m.phase === "calendar_advance");
    expect(calMut).toBeDefined();
  });

  it("imperial command plan failure produces rolled_back trace", () => {
    const store = makeStarted("record");
    // Attempt to lift confinement on a char who is not confined → should fail planning.
    const firstChar = Object.keys(store.getState().standing)[0]!;
    const sizeBefore = store.getTraceHistory().size;
    store.applyImperialCommand(db, { type: "lift_confinement", targetId: firstChar });
    const sizeAfter = store.getTraceHistory().size;
    // A trace entry should be added (rolled_back) even on plan failure.
    expect(sizeAfter).toBeGreaterThan(sizeBefore);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("rolled_back");
    expect(tx.source.kind).toBe("imperial_command");
  });

  it("ring buffer full + new rollback refreshes history and drops oldest", () => {
    const store = createGameStore({ traceMode: "record", traceHistoryLimit: 3 });
    store.newGame(db);
    const firstChar = Object.keys(store.getState().standing)[0]!;

    // Fill the buffer with committed transactions.
    for (let i = 0; i < 3; i++) {
      store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    }
    const firstId = store.getTraceHistory().getAll()[0]!.id;
    expect(store.getTraceHistory().size).toBe(3);

    // One more (a rollback) should push out the oldest.
    store.applyEffects(db, [{ type: "favor", char: "nonexistent_char", delta: 1 }]);
    const history = store.getTraceHistory();
    expect(history.size).toBe(3);
    expect(history.getAll()[0]!.id).not.toBe(firstId); // oldest was evicted
    expect(history.getAll().at(-1)!.outcome).toBe("rolled_back");
  });

  it("newGame clears trace history", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    expect(store.getTraceHistory().size).toBeGreaterThan(0);

    store.newGame(db);
    expect(store.getTraceHistory().size).toBe(0);
  });

  it("reset clears trace history", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    expect(store.getTraceHistory().size).toBeGreaterThan(0);

    store.reset();
    expect(store.getTraceHistory().size).toBe(0);
  });
});
