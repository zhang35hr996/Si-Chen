/**
 * Save format v17 → v18 migration test (PUNISH-4C).
 *
 * v17 = PUNISH-3C targetKind backfill.
 * v18 = PUNISH-4C: coldPalaceIncidents field added.
 *
 * Verifies that a v17 save without coldPalaceIncidents is migrated to v18
 * with coldPalaceIncidents: [] and passes full schema validation.
 */
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
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save format v18", () => {
  it("SAVE_FORMAT_VERSION is 18 (v17→v18 coldPalaceIncidents migration implemented)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(18);
  });

  it("round-trip at v18 preserves coldPalaceIncidents as empty array", () => {
    const s = createNewGameState(db);
    expect(s.coldPalaceIncidents).toEqual([]);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.coldPalaceIncidents).toEqual([]);
  });
});

describe("save migration v17 → v18 (coldPalaceIncidents)", () => {
  function makeV17Save(): string {
    const s = createNewGameState(db);
    const stateV17 = structuredClone(s) as unknown as Record<string, unknown>;
    delete stateV17.coldPalaceIncidents;
    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 17,
      state: stateV17,
      checksum: checksumOf(stateV17 as GameState),
    };
    return JSON.stringify(env);
  }

  it("v17 save missing coldPalaceIncidents is migrated to v18 with []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      // Provide diagnostic info if load fails
      console.error("Load error:", loaded.error);
      return;
    }
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(loaded.value.state.coldPalaceIncidents).toHaveLength(0);
  });

  it("v17 save successfully loads at SAVE_FORMAT_VERSION (18) after migration", () => {
    // LoadedSave doesn't expose formatVersion directly, but if it loaded ok
    // and coldPalaceIncidents exists, the migration completed to v18.
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // Migration added the field — migration ran => version was bumped to 18
    expect(loaded.value.state.coldPalaceIncidents).toBeDefined();
  });

  it("v17 save migration is idempotent: re-writing migrated state works", () => {
    // Load from v17, then save migrated state, then load again — no schema errors
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Re-save the migrated state (now v18) and load again
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      JSON.stringify(createSaveData(db, first.value.state, "slot1")),
    );
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state.coldPalaceIncidents).toEqual([]);
  });
});

describe("save schema rejects corrupt coldPalaceIncidents", () => {
  it("rejects save with arbitrary (non-canonical) incident ID", () => {
    const s = createNewGameState(db);
    // We need an effect to satisfy cross-link validation
    const effect = {
      id: "se_000001",
      kind: "cold_palace",
      characterId: "lu_huaijin",
      startedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      startTurn: 0,
      previousResidenceId: "yanhe_gong",
      coldPalaceResidenceId: "changmengong",
      sourcePunishmentId: "pun_000001",
    };
    const corrupt = {
      ...s,
      statusEffects: [...s.statusEffects, effect as typeof s.statusEffects[0]],
      coldPalaceIncidents: [{
        id: "arbitrary_id",  // non-canonical
        residentId: "lu_huaijin",
        effectId: "se_000001",
        kind: "petition",
        occurredAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
        acknowledged: false,
      }],
    };
    const current = createSaveData(db, corrupt, "slot1");
    const env = { ...current, state: corrupt, checksum: checksumOf(corrupt) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
  });
});
