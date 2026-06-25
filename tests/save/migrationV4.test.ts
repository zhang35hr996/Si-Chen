import { describe, expect, it } from "vitest";
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

describe("save format v4", () => {
  it("version is at least 6", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(6);
  });

  it("v5 save is rejected as OBSOLETE_VERSION (not quarantined)", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v6 = createSaveData(db, state, "slot1");

    const v5State = structuredClone(v6.state) as unknown as Record<string, unknown>;
    const taihou = (v5State.taihou ?? {}) as Record<string, unknown>;
    delete taihou.health;
    delete taihou.healthStatus;
    taihou.ill = false;
    v5State.taihou = taihou;
    delete v5State.pendingAftermath;
    const envelope = { ...v6, formatVersion: 5, state: v5State, checksum: checksumOf(v5State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1", { now: () => 5005 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });

  it("v3 save is rejected as OBSOLETE_VERSION (not quarantined)", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v6 = createSaveData(db, state, "slot1");

    const v3State = structuredClone(v6.state) as unknown as Record<string, unknown>;
    delete v3State.taihou;
    delete v3State.pendingAftermath;
    const envelope = { ...v6, formatVersion: 3, state: v3State, checksum: checksumOf(v3State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1", { now: () => 9999 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });
});
