/**
 * Save schema v9：官员家族系统字段引入（officialFamilies/familyMembers/kinship +
 * Official 形状扩展 + standing.birthFamilyId）。按 no-save-backcompat 政策不写迁移，
 * v8 及更旧存档隔离；新档 round-trip 稳定。
 */
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

describe("save schema v9（官员家族系统）", () => {
  it("SAVE_FORMAT_VERSION = 9", () => {
    expect(SAVE_FORMAT_VERSION).toBe(9);
  });

  it("fresh v9 save round-trips with officials/families/members/kinship intact", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const save = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(save));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1000 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const s = loaded.value.state;
    expect(s.officials).toEqual(state.officials);
    expect(s.officialFamilies).toEqual(state.officialFamilies);
    expect(s.familyMembers).toEqual(state.familyMembers);
    expect(s.kinship).toEqual(state.kinship);
    // 侍君 birthFamilyId 随存档保留。
    expect(s.standing["shen_zhibai"]!.birthFamilyId).toBe(state.standing["shen_zhibai"]!.birthFamilyId);
    expect(Object.keys(s.officialFamilies).length).toBeGreaterThan(0);
  });

  it("v8 save quarantines (no MIGRATIONS[8] — no-save-backcompat policy)", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const save = createSaveData(db, state, "slot1");
    const envelope = { ...save, formatVersion: 8, checksum: checksumOf(save.state) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1", { now: () => 8008 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("CORRUPT");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
    expect(storage.get(`${CORRUPT_KEY_PREFIX}8008`)).not.toBeNull();
  });

  it("migrating the same old save twice is stable (both quarantine identically)", () => {
    const make = () => {
      const storage = createMemoryStorage();
      const state = createNewGameState(db);
      const save = createSaveData(db, state, "slot1");
      const envelope = { ...save, formatVersion: 8, checksum: checksumOf(save.state) };
      storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));
      return readSlot(storage, db, "slot1", { now: () => 1 });
    };
    const a = make();
    const b = make();
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (a.ok || b.ok) return;
    expect(a.error.code).toBe(b.error.code);
  });
});
