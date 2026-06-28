/**
 * 官员家族系统存档字段（officialFamilies/familyMembers/kinship + Official 形状扩展 +
 * standing.birthFamilyId）。随 v9 schema 引入；当前 SAVE_FORMAT_VERSION 已 ≥10（合入禁足
 * statusEffects / 六宫主理 haremAdministration）。按 no-save-backcompat：官员世界字段无 backfill，
 * 缺失即被 gameStateSchema 拒绝并 quarantine。新档 round-trip 稳定。
 */
import { describe, it, expect } from "vitest";
import {
  CORRUPT_KEY_PREFIX,
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save schema — 官员家族字段持久化", () => {
  it("SAVE_FORMAT_VERSION ≥ 10", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(10);
  });

  it("fresh save round-trips with officials/families/members/kinship intact", () => {
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
    // shen_zhibai is now event_only; verify the generated empress round-trips instead
    const empressId = Object.keys(state.standing).find((id) => state.standing[id]!.rank === "huanghou")!;
    expect(s.standing[empressId]).toMatchObject(state.standing[empressId]!);
    expect(Object.keys(s.officialFamilies).length).toBeGreaterThan(0);
  });

  /** 模拟「官员家族字段缺失」的旧档，写出并经 readSlot 校验。 */
  function quarantineWith(strip: (s: Record<string, unknown>) => void, now: number) {
    const storage = createMemoryStorage();
    const state = createNewGameState(db) as unknown as Record<string, unknown>;
    strip(state);
    const save = createSaveData(db, state as unknown as GameState, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(save));
    const loaded = readSlot(storage, db, "slot1", { now: () => now });
    expect(loaded.ok).toBe(false);
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
    expect(storage.get(`${CORRUPT_KEY_PREFIX}${now}`)).not.toBeNull();
  }

  it("a save missing officialFamilies is rejected (schema gate) and quarantined", () => {
    quarantineWith((s) => { delete s["officialFamilies"]; }, 2001);
  });

  it("a save missing kinship is rejected and quarantined", () => {
    quarantineWith((s) => { delete s["kinship"]; }, 2002);
  });
});
