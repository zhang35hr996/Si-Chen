/**
 * Save schema v8 tests.
 *
 * Per no-save-backcompat policy: all pre-v12 saves are rejected with OBSOLETE_VERSION.
 * v7 and v8 saves were valid in their time but are no longer migrated.
 * The current save format (v12+) round-trips cleanly.
 */
import { describe, it, expect } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function makeV7Envelope() {
  const state = createNewGameState(db);
  const current = createSaveData(db, state, "slot1");
  const stateV7 = { ...current.state } as Record<string, unknown>;
  delete stateV7["eventReactionLog"];
  return { ...current, formatVersion: 7, state: stateV7, checksum: checksumOf(stateV7) };
}

describe("save schema v8", () => {
  it("SAVE_FORMAT_VERSION is at least 12", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(12);
  });

  it("fresh save round-trips successfully", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const save = createSaveData(db, state, "slot1");

    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(save));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.eventReactionLog).toBeDefined();
    expect(Array.isArray(loaded.value.state.eventReactionLog)).toBe(true);
  });

  it("v7 save is rejected as OBSOLETE_VERSION (not quarantined)", () => {
    const storage = createMemoryStorage();
    const v7 = makeV7Envelope();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });

  it("v6 save is rejected as OBSOLETE_VERSION (not quarantined)", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const current = createSaveData(db, state, "slot1");
    const envelope = { ...current, formatVersion: 6, checksum: checksumOf(current.state) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1", { now: () => 6006 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });
});
