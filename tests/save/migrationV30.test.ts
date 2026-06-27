/**
 * SAVE v30 迁移测试：haremDisciplineIncidents（PUNISH-4G-B）
 *
 * 覆盖：
 * - v29 存档升级至 v30（haremDisciplineIncidents 补 default []）
 * - SAVE_FORMAT_VERSION = 30
 * - round-trip save/load（createSaveData → loadSave）
 */
import { describe, expect, it } from "vitest";
import {
  SAVE_FORMAT_VERSION,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

it("V30-01: SAVE_FORMAT_VERSION = 30", () => {
  expect(SAVE_FORMAT_VERSION).toBe(30);
});

describe("v29 → v30 migration", () => {
  it("V30-02: v29 save without haremDisciplineIncidents loads as v30 with []", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    // Manually strip haremDisciplineIncidents to simulate v29 save
    const v29State = { ...state } as Record<string, unknown>;
    delete v29State.haremDisciplineIncidents;

    const v29Envelope = {
      formatVersion: 29,
      engineVersion: "test",
      contentVersion: "test",
      contentHash: "test_hash",
      createdAt: new Date().toISOString(),
      slot: "slot_1",
      checksum: checksumOf(v29State),
      state: v29State,
    };

    storage.set(`${SAVE_KEY_PREFIX}slot_1`, JSON.stringify(v29Envelope));
    const result = readSlot(storage, db, "slot_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.haremDisciplineIncidents).toEqual([]);
  });

  it("V30-03: round-trip createSaveData → readSlot preserves haremDisciplineIncidents", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot_1");
    storage.set(`${SAVE_KEY_PREFIX}slot_1`, JSON.stringify(saveData));
    const result = readSlot(storage, db, "slot_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.haremDisciplineIncidents).toEqual([]);
  });
});
