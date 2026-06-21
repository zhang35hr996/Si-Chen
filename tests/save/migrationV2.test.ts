import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  CORRUPT_KEY_PREFIX,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save migration v1 (no-save-backcompat: quarantines at v5→v6 boundary)", () => {
  it("v1 save quarantines — no MIGRATIONS[5] to reach v6", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const current = createSaveData(db, state, "slot1");
    const v1State = structuredClone(current.state) as unknown as Record<string, unknown>;
    const bloodline = (v1State.resources as { bloodline: Record<string, unknown> }).bloodline;
    const gest = {
      carrier: "lu_huaijin",
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      fatherId: "lu_huaijin",
      transferredAtMonth: 3,
    };
    delete bloodline.gestations;
    bloodline.gestation = gest;
    const envelope = { ...current, formatVersion: 1, state: v1State, checksum: checksumOf(v1State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1001 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("CORRUPT");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
    expect(storage.get(`${CORRUPT_KEY_PREFIX}1001`)).not.toBeNull();
  });
});
