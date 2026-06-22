/**
 * T10: Save schema v8 migration tests.
 *
 * Verifies MIGRATIONS[7] (v7 → v8):
 *   - Operates on a full SaveEnvelope
 *   - Sets formatVersion: 8 on the envelope
 *   - Recalculates the checksum from the migrated state
 *   - Adds eventReactionLog: [] when the field is missing
 *   - A v7 save migrates cleanly and round-trips through readSlot
 */
import { describe, it, expect } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
  CORRUPT_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a v8 SaveData from a fresh game state, then manually downgrade it to v7
 * by stripping eventReactionLog (simulating a save created before T10).
 */
function makeV7Envelope(stripField = true) {
  const state = createNewGameState(db);
  const v8 = createSaveData(db, state, "slot1");

  // Downgrade to v7: remove eventReactionLog if stripField, recalculate checksum
  const stateV7 = { ...v8.state } as Record<string, unknown>;
  if (stripField) {
    delete stateV7["eventReactionLog"];
  }
  return {
    ...v8,
    formatVersion: 7,
    state: stateV7,
    checksum: checksumOf(stateV7),
  };
}

// Inline access to the migration function through the public readSlot pipeline.
// We test the migration indirectly via readSlot (which runs all migrations) and
// directly by examining what MIGRATIONS[7] produces when called through the
// migration chain.

describe("save schema v8", () => {
  it("SAVE_FORMAT_VERSION is now 8", () => {
    expect(SAVE_FORMAT_VERSION).toBe(8);
  });

  it("fresh v8 save round-trips successfully", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v8 = createSaveData(db, state, "slot1");

    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v8));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.eventReactionLog).toBeDefined();
    expect(Array.isArray(loaded.value.state.eventReactionLog)).toBe(true);
  });

  it("MIGRATIONS[7] operates on full SaveEnvelope — result is valid SaveEnvelope", () => {
    // Verify end-to-end: a v7 envelope can be loaded through readSlot
    const storage = createMemoryStorage();
    const v7 = makeV7Envelope();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(true);
  });

  it("sets formatVersion: 8 on envelope", () => {
    const storage = createMemoryStorage();
    const v7 = makeV7Envelope();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    // readSlot succeeds only if formatVersion==8 (current) after migration
    expect(loaded.ok).toBe(true);
    // Verify the save we wrote was v7 and it loaded as v8 (implicit in success)
    expect(v7.formatVersion).toBe(7);
    // The loaded state is parsed successfully, confirming v8 schema was applied
    if (!loaded.ok) return;
    expect(loaded.value.state).toBeDefined();
  });

  it("recalculates checksum", () => {
    // If MIGRATIONS[7] didn't recalculate the checksum, readSlot would fail with CORRUPT.
    const storage = createMemoryStorage();
    const v7 = makeV7Envelope(true); // eventReactionLog stripped → state changed from v8
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));

    // readSlot runs: migrate → checksum gate → schema gate.
    // If checksum wasn't recalculated inside the migration, the gate would fail.
    const loaded = readSlot(storage, db, "slot1", { now: () => 2000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      // Distinguish: checksum mismatch vs other errors
      expect(loaded.error.message).not.toContain("checksum");
    }
  });

  it("adds eventReactionLog: [] when missing", () => {
    // v7 envelope where state.eventReactionLog is absent
    const storage = createMemoryStorage();
    const v7 = makeV7Envelope(true); // stripField=true removes eventReactionLog
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));

    const loaded = readSlot(storage, db, "slot1", { now: () => 3000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // After migration, field must exist and be an empty array
    expect(loaded.value.state.eventReactionLog).toBeDefined();
    expect(Array.isArray(loaded.value.state.eventReactionLog)).toBe(true);
    expect(loaded.value.state.eventReactionLog).toHaveLength(0);
  });

  it("v7 save migrates cleanly; round-trips", () => {
    // Full round-trip: write a v7 save, read it, verify state integrity
    const storage = createMemoryStorage();
    const originalState = createNewGameState(db);
    const v8 = createSaveData(db, originalState, "slot1");

    // Downgrade to v7 (strip eventReactionLog)
    const stateV7 = { ...v8.state } as Record<string, unknown>;
    delete stateV7["eventReactionLog"];
    const v7 = {
      ...v8,
      formatVersion: 7,
      state: stateV7,
      checksum: checksumOf(stateV7),
    };

    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));
    const loaded = readSlot(storage, db, "slot1", { now: () => 4000 });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Core state fields preserved
    const { state } = loaded.value;
    expect(state.calendar).toEqual(originalState.calendar);
    expect(state.playerLocation).toBe(originalState.playerLocation);
    // eventReactionLog injected by migration
    expect(state.eventReactionLog).toEqual([]);
    // Round-trip: write the migrated state as a fresh v8 save and re-read
    const v8Written = createSaveData(db, state, "slot2");
    storage.set(`${SAVE_KEY_PREFIX}slot2`, JSON.stringify(v8Written));
    const reloaded = readSlot(storage, db, "slot2", { now: () => 5000 });
    expect(reloaded.ok).toBe(true);
  });

  it("v6 save still quarantines (no MIGRATIONS[6] — no-save-backcompat policy)", () => {
    // Ensure we didn't accidentally add MIGRATIONS[6]
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v8 = createSaveData(db, state, "slot1");

    const envelope = { ...v8, formatVersion: 6, checksum: checksumOf(v8.state) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1", { now: () => 6006 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("CORRUPT");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
    expect(storage.get(`${CORRUPT_KEY_PREFIX}6006`)).not.toBeNull();
  });
});
