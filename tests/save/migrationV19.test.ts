/**
 * Save format v18 → v19 migration test (PUNISH-4C).
 *
 * v17 = PUNISH-3C: targetKind backfill for punishments.
 * v18 = PR3C-3b: personnelDecisions field added (officials personnel events).
 * v19 = PUNISH-4C: coldPalaceIncidents field added.
 *
 * Tests:
 *  1. v18 → v19: missing coldPalaceIncidents is backfilled as [].
 *  2. v17 → v18 → v19 chain: old save acquires both personnelDecisions and
 *     coldPalaceIncidents after running the full migration chain.
 *  3. Round-trip at v19 preserves coldPalaceIncidents.
 *  4. Schema rejects corrupt incident records.
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
import type { CharacterStatusEffect, ColdPalaceIncident, GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

// ── Current version ──────────────────────────────────────────────────────────

describe("save format v19", () => {
  it("SAVE_FORMAT_VERSION includes the v19 migration (v18→v19 coldPalaceIncidents)", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(19);
  });

  it("round-trip at v19 preserves coldPalaceIncidents as empty array", () => {
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

// ── v18 → v19 migration ───────────────────────────────────────────────────────

describe("save migration v18 → v19 (coldPalaceIncidents)", () => {
  function makeV18Save(): string {
    const s = createNewGameState(db);
    // v18 state: has personnelDecisions (from v17→v18 migration) but no coldPalaceIncidents.
    const stateV18 = structuredClone(s) as unknown as Record<string, unknown>;
    delete stateV18.coldPalaceIncidents;
    // Ensure personnelDecisions is present (as it would be in a real v18 save).
    if (stateV18.personnelDecisions === undefined) {
      stateV18.personnelDecisions = {};
    }
    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 18,
      state: stateV18,
      checksum: checksumOf(stateV18 as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v18 save missing coldPalaceIncidents is migrated to v19 with []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV18Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(loaded.value.state.coldPalaceIncidents).toHaveLength(0);
  });

  it("v18 save migration is idempotent: re-writing migrated state works", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV18Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Re-save migrated state (now v19) and reload — no schema errors, no data loss.
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

// ── v17 → v18 → v19 chain migration ──────────────────────────────────────────

describe("save migration chain v17 → v18 → v19", () => {
  function makeV17Save(): string {
    const s = createNewGameState(db);
    // v17 state: no personnelDecisions, no coldPalaceIncidents.
    const stateV17 = structuredClone(s) as unknown as Record<string, unknown>;
    delete stateV17.coldPalaceIncidents;
    delete stateV17.personnelDecisions;
    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 17,
      state: stateV17,
      checksum: checksumOf(stateV17 as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v17 save is migrated through v18 and v19 to acquire both personnelDecisions and coldPalaceIncidents", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // v17→v18 backfilled personnelDecisions
    const state = loaded.value.state as unknown as Record<string, unknown>;
    expect(state.personnelDecisions).toBeDefined();
    // v18→v19 backfilled coldPalaceIncidents
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(loaded.value.state.coldPalaceIncidents).toHaveLength(0);
  });

  it("v17 chain migration round-trips: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Persist the fully-migrated state and reload
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      JSON.stringify(createSaveData(db, loaded.value.state, "slot1")),
    );
    const reloaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.state.coldPalaceIncidents).toEqual([]);
    const state = reloaded.value.state as unknown as Record<string, unknown>;
    expect(state.personnelDecisions).toBeDefined();
  });
});

// ── Schema rejects corrupt incidents ─────────────────────────────────────────

describe("save schema rejects corrupt coldPalaceIncidents", () => {
  it("rejects save with arbitrary (non-canonical) incident ID", () => {
    const s = createNewGameState(db);
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
    const incident: ColdPalaceIncident = {
      id: "arbitrary_id",  // non-canonical — should be cpi_{charId}_{year}_{MM}
      residentId: "lu_huaijin",
      effectId: "se_000001",
      kind: "petition",
      occurredAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      acknowledged: false,
    };
    const corrupt: GameState = {
      ...s,
      statusEffects: [...s.statusEffects, effect as CharacterStatusEffect],
      coldPalaceIncidents: [incident],
    };
    const current = createSaveData(db, corrupt, "slot1");
    const env = { ...current, state: corrupt, checksum: checksumOf(corrupt) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
  });
});
