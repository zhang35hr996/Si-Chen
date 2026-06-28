/**
 * Save format v23 → v24 migration tests (PUNISH-4F: 冷宫精神失常).
 *
 * v23 = Phase 4B: 财政奏折框架 (treasuryLedger)
 * v24 = PUNISH-4F: ColdPalaceMadnessEffect + ColdPalaceMentalBreakdownIncident
 *
 * The v23→v24 migration is a structural no-op:
 *   - No new required fields on GameState
 *   - ColdPalaceMadnessEffect goes in existing statusEffects array (Zod defaults OK)
 *   - ColdPalaceMentalBreakdownIncident goes in coldPalaceIncidents array (same)
 *   - Old saves without these entries load fine (empty arrays remain empty)
 *
 * Chain: v19→v20→v21→v22→v23→v24
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
import type {
  ColdPalaceMadnessEffect,
  ColdPalaceMentalBreakdownIncident,
  GameState,
} from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";
import { createGameStore } from "../../src/store/gameStore";
import { activeColdPalaceEffectFor } from "../../src/engine/characters/coldPalace";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";

// ── Current version ───────────────────────────────────────────────────────────

describe("save format v24", () => {
  it("SAVE_FORMAT_VERSION is at least 24", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(24);
  });

  it("new game state loads without madness effects", () => {
    const s = createNewGameState(db);
    expect(s.statusEffects.filter((e) => e.kind === "cold_palace_madness")).toHaveLength(0);
    expect(s.coldPalaceIncidents.filter((i) => i.kind === "mental_breakdown")).toHaveLength(0);
  });
});

// ── v23 → v24 migration helpers ───────────────────────────────────────────────

function makeV23Save(stateOverrides?: (s: Record<string, unknown>) => void): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  stateOverrides?.(raw);
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 23,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

/** Use the store to build a properly-structured cold-palace state. */
function stateWithColdPalaceResident(): GameState {
  const store = createGameStore();
  store.loadState(withConsort(createNewGameState(db), db, REAL_TARGET_ID));
  const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
  expect(r.ok).toBe(true);
  return store.getState();
}

/** Add a ColdPalaceMadnessEffect + incident on top of a cold-palace state. */
function stateWithMadness(base: GameState): {
  state: GameState;
  madnessEffectId: string;
  incidentId: string;
} {
  const effect = activeColdPalaceEffectFor(base, REAL_TARGET_ID)!;
  const { year, month, period, dayIndex } = base.calendar;
  const madnessEffectId = `se_${REAL_TARGET_ID}_madness`;
  const incidentId = `cpi_${REAL_TARGET_ID}_${year}_${String(month).padStart(2, "0")}`;
  const madnessEffect: ColdPalaceMadnessEffect = {
    id: madnessEffectId,
    kind: "cold_palace_madness",
    characterId: REAL_TARGET_ID,
    sourceColdPalaceEffectId: effect.id,
    startedAt: { year, month, period, dayIndex },
    startTurn: dayIndex,
  };
  const incident: ColdPalaceMentalBreakdownIncident = {
    id: incidentId,
    residentId: REAL_TARGET_ID,
    effectId: effect.id,
    kind: "mental_breakdown",
    occurredAt: { year, month, period, dayIndex },
    acknowledged: false,
    madnessEffectId,
  };
  return {
    state: {
      ...base,
      statusEffects: [...base.statusEffects, madnessEffect],
      coldPalaceIncidents: [...base.coldPalaceIncidents, incident],
    },
    madnessEffectId,
    incidentId,
  };
}

// ── v23 → v24 migration ───────────────────────────────────────────────────────

describe("save migration v23 → v24", () => {
  it("v23 save loads successfully", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV23Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
  });

  it("v23 save: statusEffects without madness remains valid", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV23Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.statusEffects.every((e) => e.kind !== "cold_palace_madness")).toBe(true);
  });

  it("v23 save: coldPalaceIncidents without mental_breakdown remains valid", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV23Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.coldPalaceIncidents.every((i) => i.kind !== "mental_breakdown")).toBe(true);
  });

  it("migration is idempotent: re-saving migrated state loads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV23Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      JSON.stringify(createSaveData(db, first.value.state, "slot1")),
    );
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
  });

  it("checksum is correct after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV23Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
  });
});

// ── v24 state with madness round-trips cleanly ────────────────────────────────

describe("v24 state with ColdPalaceMadnessEffect", () => {
  it("saves and reloads madness effect and incident", () => {
    const cpState = stateWithColdPalaceResident();
    const { state, madnessEffectId, incidentId } = stateWithMadness(cpState);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("round-trip error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const ls = loaded.value.state;
    expect(ls.statusEffects.some((e) => e.id === madnessEffectId && e.kind === "cold_palace_madness")).toBe(true);
    expect(ls.coldPalaceIncidents.some((i) => i.id === incidentId && i.kind === "mental_breakdown")).toBe(true);
  });

  it("madness effect persists across re-save (second round-trip)", () => {
    const cpState = stateWithColdPalaceResident();
    const { state, madnessEffectId } = stateWithMadness(cpState);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Re-save and reload
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, first.value.state, "slot1")));
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state.statusEffects.some((e) => e.id === madnessEffectId)).toBe(true);
  });

  it("acknowledged mental_breakdown incident round-trips", () => {
    const cpState = stateWithColdPalaceResident();
    const { state, incidentId } = stateWithMadness(cpState);
    // Acknowledge the incident
    const acked: GameState = {
      ...state,
      coldPalaceIncidents: state.coldPalaceIncidents.map((i) =>
        i.id === incidentId ? { ...i, acknowledged: true } : i,
      ),
    };

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, acked, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const incident = loaded.value.state.coldPalaceIncidents.find((i) => i.id === incidentId);
    expect(incident?.acknowledged).toBe(true);
  });

  it("rejects state with bad madness cross-link (madnessEffectId points to nonexistent effect)", () => {
    const cpState = stateWithColdPalaceResident();
    const { state, incidentId } = stateWithMadness(cpState);
    // Break the cross-link in the incident
    const brokenState: GameState = {
      ...state,
      coldPalaceIncidents: state.coldPalaceIncidents.map((i) =>
        i.id === incidentId
          ? { ...i, madnessEffectId: "nonexistent_madness_id" }
          : i,
      ),
    };

    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      JSON.stringify({ ...createSaveData(db, cpState, "slot1"), state: brokenState, checksum: checksumOf(brokenState) }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
  });

  it("rejects state with duplicate madness effects for same character", () => {
    const cpState = stateWithColdPalaceResident();
    const { state, madnessEffectId } = stateWithMadness(cpState);
    const madnessEffect = state.statusEffects.find((e) => e.id === madnessEffectId)!;
    const dupEffect: ColdPalaceMadnessEffect = {
      ...(madnessEffect as ColdPalaceMadnessEffect),
      id: `${madnessEffectId}_dup`,
    };
    const brokenState: GameState = {
      ...state,
      statusEffects: [...state.statusEffects, dupEffect],
    };

    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      JSON.stringify({ ...createSaveData(db, cpState, "slot1"), state: brokenState, checksum: checksumOf(brokenState) }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
  });
});

// ── Full migration chain v19 → v24 ───────────────────────────────────────────

describe("save migration chain v19 → v20 → v21 → v22 → v23 → v24", () => {
  function makeV19Save(): string {
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;
    delete raw.memorials;
    delete raw.treasuryLedger;
    delete raw.coldPalaceIncidents;
    delete raw.coldPalaceInterventions;
    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 19,
      state: raw,
      checksum: checksumOf(raw as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v19 save migrates all the way to v24", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV19Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // Structural integrity after full chain
    expect(loaded.value.state.memorials).toEqual({});
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(Array.isArray(loaded.value.state.coldPalaceInterventions)).toBe(true);
    expect(Array.isArray(loaded.value.state.treasuryLedger)).toBe(true);
    // v24 specific: no madness effects on a fresh migrated state
    expect(loaded.value.state.statusEffects.filter((e) => e.kind === "cold_palace_madness")).toHaveLength(0);
    expect(loaded.value.state.coldPalaceIncidents.filter((i) => i.kind === "mental_breakdown")).toHaveLength(0);
  });

  it("v19 chain round-trip: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV19Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      JSON.stringify(createSaveData(db, first.value.state, "slot1")),
    );
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state.memorials).toEqual({});
    expect(second.value.state.treasuryLedger).toEqual([]);
  });
});
