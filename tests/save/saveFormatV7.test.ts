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

describe("SAVE_FORMAT_VERSION = 7（Phase 3 字段引入，旧档隔离）", () => {
  it("常量已 bump 到 ≥10（官员家族 + 禁足 statusEffects + 六宫主理字段引入）", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(10);
  });

  it("fresh save round-trips successfully", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const save = createSaveData(db, state, "slot1");

    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(save));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.meta.contentVersion).toBe(db.contentVersion);
    expect(loaded.value.state).toBeDefined();
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
    // Not quarantined — expected obsolete saves are not treated as corrupt.
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });
});
