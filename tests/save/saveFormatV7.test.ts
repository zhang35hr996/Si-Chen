import { describe, it, expect } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  CORRUPT_KEY_PREFIX,
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("SAVE_FORMAT_VERSION = 7（Phase 3 字段引入，旧档隔离）", () => {
  it("常量已 bump 到 ≥10（官员家族 + 禁足 statusEffects + 六宫主理字段引入）", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(10);
  });

  it("fresh v7 save round-trips successfully", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v7 = createSaveData(db, state, "slot1");

    // Write the v7 save as JSON to storage
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(v7));

    // Read it back
    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.meta.contentVersion).toBe(db.contentVersion);
    expect(loaded.value.state).toBeDefined();
  });

  it("v6 save quarantines (no MIGRATIONS[6] — no-save-backcompat policy)", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v7 = createSaveData(db, state, "slot1");

    // Simulate a v6 save by downgrading the envelope
    const envelope = { ...v7, formatVersion: 6, checksum: checksumOf(v7.state) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    // Try to read it
    const loaded = readSlot(storage, db, "slot1", { now: () => 6006 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("CORRUPT");
    // Verify quarantine: original key removed, corrupt key created
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
    expect(storage.get(`${CORRUPT_KEY_PREFIX}6006`)).not.toBeNull();
  });
});
