/**
 * PUNISH-4E: Save format v21 → v22 migration test.
 *
 * v21→v22: New coldPalaceInterventions field (append-only intervention log).
 * Old saves (v21) lack this field — schema.default([]) fills it in; migration only bumps version.
 *
 * Tests:
 *  1. SAVE_FORMAT_VERSION is 22.
 *  2. New game state initialises coldPalaceInterventions as empty array.
 *  3. v21 save with no coldPalaceInterventions migrates cleanly (default=[]).
 *  4. v21 migration is idempotent.
 *  5. v17→v22 chain: acquires personnelDecisions, coldPalaceIncidents, memorials, and interventions.
 *  6. Round-trip: personal_visit intervention survives save/load.
 *  7. Round-trip: physician intervention survives save/load.
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  writeSave,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";
import { createGameStore } from "../../src/store/gameStore";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";

function makeV21Save(): string {
  const s = createNewGameState(db);
  const stateV21 = structuredClone(s) as unknown as Record<string, unknown>;
  // v21 save: has coldPalaceIncidents + memorials but NO coldPalaceInterventions
  stateV21.coldPalaceIncidents = [];
  stateV21.memorials = {};
  delete stateV21.coldPalaceInterventions;
  const current = createSaveData(db, s, "slot1");
  return JSON.stringify({
    ...current,
    formatVersion: 21,
    state: stateV21,
    checksum: checksumOf(stateV21 as unknown as GameState),
  });
}

function makeV17Save(): string {
  const s = createNewGameState(db);
  const stateV17 = structuredClone(s) as unknown as Record<string, unknown>;
  delete stateV17.coldPalaceIncidents;
  delete stateV17.coldPalaceInterventions;
  delete stateV17.personnelDecisions;
  delete stateV17.memorials;
  const current = createSaveData(db, s, "slot1");
  return JSON.stringify({
    ...current,
    formatVersion: 17,
    state: stateV17,
    checksum: checksumOf(stateV17 as unknown as GameState),
  });
}

// ── Current version ───────────────────────────────────────────────────────────

describe("save format v22", () => {
  it("SAVE_FORMAT_VERSION is 22 (v21→v22 coldPalaceInterventions)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(22);
  });

  it("new game state coldPalaceInterventions defaults to empty array", () => {
    const s = createNewGameState(db);
    expect(Array.isArray(s.coldPalaceInterventions)).toBe(true);
    expect(s.coldPalaceInterventions).toHaveLength(0);
  });
});

// ── v21 → v22 migration ───────────────────────────────────────────────────────

describe("save migration v21 → v22 (coldPalaceInterventions added)", () => {
  it("v21 save without coldPalaceInterventions migrates to v22 with empty array", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV21Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.coldPalaceInterventions)).toBe(true);
    expect(loaded.value.state.coldPalaceInterventions).toHaveLength(0);
  });

  it("v21 migration is idempotent: re-save migrated state succeeds", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV21Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, first.value.state, "slot1")));
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state.coldPalaceInterventions).toHaveLength(0);
  });
});

// ── Chain migration v17 → ... → v22 ─────────────────────────────────────────

describe("save migration chain v17 → ... → v22", () => {
  it("v17 save migrates through all versions acquiring personnelDecisions, coldPalaceIncidents, memorials, and interventions", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const state = loaded.value.state as unknown as Record<string, unknown>;
    expect(state.personnelDecisions).toBeDefined();
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(state.memorials).toBeDefined();
    expect(Array.isArray(loaded.value.state.coldPalaceInterventions)).toBe(true);
    expect(loaded.value.state.coldPalaceInterventions).toHaveLength(0);
  });

  it("v17 chain round-trips: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, loaded.value.state, "slot1")));
    const reloaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.state.coldPalaceInterventions).toHaveLength(0);
  });
});

// ── Round-trip with real ColdPalaceIntervention state ────────────────────────

describe("round-trip: ColdPalaceIntervention in real GameState", () => {
  it("personal_visit intervention survives save/load round-trip", () => {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(r.ok).toBe(true);
    const s = store.getState();
    const effectId = s.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )?.id;
    expect(effectId).toBeDefined();

    const stateWithIntervention: GameState = {
      ...s,
      coldPalaceInterventions: [{
        id: `cpa_${REAL_TARGET_ID}_${s.calendar.year}_${String(s.calendar.month).padStart(2, "0")}`,
        residentId: REAL_TARGET_ID,
        effectId: effectId!,
        kind: "personal_visit",
        occurredAt: { year: s.calendar.year, month: s.calendar.month, period: s.calendar.period, dayIndex: s.calendar.dayIndex },
        favorDelta: 5,
      }],
    };

    const storage = createMemoryStorage();
    writeSave(storage, db, stateWithIntervention, "slot1");
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const interventions = loaded.value.state.coldPalaceInterventions;
    expect(interventions).toHaveLength(1);
    const iv = interventions[0]!;
    expect(iv.kind).toBe("personal_visit");
    if (iv.kind === "personal_visit") {
      expect(iv.residentId).toBe(REAL_TARGET_ID);
      expect(iv.favorDelta).toBe(5);
    }
  });

  it("physician intervention survives save/load round-trip", () => {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(r.ok).toBe(true);
    const s = store.getState();
    const effectId = s.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )?.id;
    expect(effectId).toBeDefined();

    const stateWithPhysician: GameState = {
      ...s,
      coldPalaceInterventions: [{
        id: `cpa_${REAL_TARGET_ID}_${s.calendar.year}_${String(s.calendar.month).padStart(2, "0")}`,
        residentId: REAL_TARGET_ID,
        effectId: effectId!,
        kind: "physician",
        occurredAt: { year: s.calendar.year, month: s.calendar.month, period: s.calendar.period, dayIndex: s.calendar.dayIndex },
        healthDelta: 10,
      }],
    };

    const storage = createMemoryStorage();
    writeSave(storage, db, stateWithPhysician, "slot1");
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const interventions = loaded.value.state.coldPalaceInterventions;
    expect(interventions).toHaveLength(1);
    const iv = interventions[0]!;
    expect(iv.kind).toBe("physician");
    if (iv.kind === "physician") {
      expect(iv.residentId).toBe(REAL_TARGET_ID);
      expect(iv.healthDelta).toBe(10);
    }
  });
});
