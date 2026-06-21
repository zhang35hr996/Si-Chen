import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save format v4", () => {
  it("version is at least 6", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(6);
  });

  it("migration v3 → v6: backfills taihou with health/healthStatus when absent", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v6 = createSaveData(db, state, "slot1");

    // Simulate a v3 save that lacks the taihou key
    const v3State = structuredClone(v6.state) as unknown as Record<string, unknown>;
    delete v3State.taihou;
    delete v3State.pendingAftermath;
    const envelope = { ...v6, formatVersion: 3, state: v3State, checksum: checksumOf(v3State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.taihou.health).toBe(70);
    expect(loaded.value.state.taihou.healthStatus).toBe("healthy");
  });
});
