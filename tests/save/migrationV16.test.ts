/**
 * Save format v15 → v16 migration test (PR7A).
 *
 * v15 = main's annualReviews migration.
 * v16 = PR7A: apMax changed from 6 to 5.
 *
 * Saves at v14 pass through both v14→v15 (annualReviews) and v15→v16 (apMax).
 * Saves at v15 only pass through v15→v16.
 * Either way the result must have apMax=5 and annualReviews present.
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX, createSaveData } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save format v16", () => {
  it("SAVE_FORMAT_VERSION ≥ 16 (v15→v16 AP migration implemented)", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(16);
  });

  it("round-trip at v16 preserves apMax=5", () => {
    const s = createNewGameState(db);
    expect(s.calendar.apMax).toBe(5);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(Array.isArray(loaded.value.state.annualReviews)).toBe(true);
  });
});

describe("save migration v15 → v16 (apMax 6 → 5)", () => {
  function makeV15Save(apMax: number, ap: number): string {
    const s = createNewGameState(db);
    const stateV15: GameState = {
      ...s,
      calendar: { ...s.calendar, apMax, ap: Math.min(ap, apMax) },
      annualReviews: [],
    };
    const env = {
      ...createSaveData(db, stateV15, "slot1"),
      formatVersion: 15,
      checksum: checksumOf(stateV15),
    };
    return JSON.stringify(env);
  }

  it("v15 save with apMax=6, ap=6 → migrated to apMax=5, ap=5", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV15Save(6, 6));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(5);
  });

  it("v15 save with apMax=6, ap=3 → apMax clamped, ap unchanged", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV15Save(6, 3));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(3);
  });

  it("v15 save with apMax=5 (already canonical) → unchanged", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV15Save(5, 4));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(4);
  });

  it("v15 save: ap invariant ap ≤ apMax holds after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV15Save(6, 6));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const cal = loaded.value.state.calendar;
    expect(cal.ap).toBeLessThanOrEqual(cal.apMax);
  });
});

describe("save migration v14 → v15 → v16 (both migrations run)", () => {
  function makeV14Save(apMax: number, ap: number): string {
    const s = createNewGameState(db);
    const stateV14: GameState = {
      ...s,
      calendar: { ...s.calendar, apMax, ap: Math.min(ap, apMax) },
    };
    const env = {
      ...createSaveData(db, stateV14, "slot1"),
      formatVersion: 14,
      checksum: checksumOf(stateV14),
    };
    return JSON.stringify(env);
  }

  it("v14 save with apMax=6 arrives at apMax=5 and has annualReviews", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV14Save(6, 6));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(5);
    expect(Array.isArray(loaded.value.state.annualReviews)).toBe(true);
  });

  it("v14 save with apMax=5 passes through cleanly (annualReviews added, apMax unchanged)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV14Save(5, 3));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(3);
    expect(Array.isArray(loaded.value.state.annualReviews)).toBe(true);
  });
});
