/**
 * Save format v14 → v15 migration test.
 *
 * PR7A changed apMax from 6 to 5.  Saves created with v14 (apMax=6) must be
 * loaded and clamped to apMax=5 without data loss.  Saves already at apMax=5
 * must be unchanged.
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX, createSaveData } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save format v15", () => {
  it("SAVE_FORMAT_VERSION is 15", () => {
    expect(SAVE_FORMAT_VERSION).toBe(15);
  });

  it("round-trip at v15 preserves apMax=5", () => {
    const s = createNewGameState(db);
    expect(s.calendar.apMax).toBe(5);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
  });
});

describe("save migration v14 → v15", () => {
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

  it("v14 save with apMax=6, ap=6 → migrated to apMax=5, ap=5", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV14Save(6, 6));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(5);
  });

  it("v14 save with apMax=6, ap=3 → migrated to apMax=5, ap=3 (ap unchanged when already ≤5)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV14Save(6, 3));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(3);
  });

  it("v14 save with apMax=5 (already canonical) → unchanged after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV14Save(5, 4));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.calendar.apMax).toBe(5);
    expect(loaded.value.state.calendar.ap).toBe(4);
  });

  it("v14 save with apMax=6, ap=6 that was mid-turn → ap clamped to 5", () => {
    // Simulates a save taken just after a game started (full AP day)
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV14Save(6, 6));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const cal = loaded.value.state.calendar;
    // Invariant: ap ≤ apMax must hold after migration
    expect(cal.ap).toBeLessThanOrEqual(cal.apMax);
  });
});
