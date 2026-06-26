/**
 * PUNISH-4D: Save format v20 → v21 migration test.
 *
 * v20→v21: ColdPalaceIncident extended to discriminated union with critical_illness kind.
 * Old saves (v20) have only petition/health_deterioration records — schema parses them.
 * Migration only bumps formatVersion; no data transformation.
 *
 * Chain: v17→v18 (personnelDecisions) → v19 (coldPalaceIncidents) → v20 (memorials) → v21 (critical_illness union)
 *
 * Tests:
 *  1. SAVE_FORMAT_VERSION is 21.
 *  2. v20→v21: empty coldPalaceIncidents migrates cleanly.
 *  3. v20 migration is idempotent.
 *  4. v17→v21 chain: acquires personnelDecisions, coldPalaceIncidents, and memorials.
 *  5. Schema rejects critical_illness with invalid status.
 *  6. Round-trip preserves resolved critical_illness incident.
 *  7. Round-trip preserves pending critical_illness incident.
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

function makeV20Save(): string {
  const s = createNewGameState(db);
  const stateV20 = structuredClone(s) as unknown as Record<string, unknown>;
  // v20 save: has coldPalaceIncidents + memorials, no critical_illness union (additive)
  stateV20.coldPalaceIncidents = [];
  stateV20.memorials = {};
  const current = createSaveData(db, s, "slot1");
  return JSON.stringify({
    ...current,
    formatVersion: 20,
    state: stateV20,
    checksum: checksumOf(stateV20 as unknown as GameState),
  });
}

function makeV17Save(): string {
  const s = createNewGameState(db);
  const stateV17 = structuredClone(s) as unknown as Record<string, unknown>;
  delete stateV17.coldPalaceIncidents;
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

// ── Current version ──────────────────────────────────────────────────────────

describe("save format v21", () => {
  it("SAVE_FORMAT_VERSION is 21 (v20→v21 critical_illness discriminated union)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(21);
  });

  it("new game state coldPalaceIncidents defaults to empty array", () => {
    const s = createNewGameState(db);
    expect(Array.isArray(s.coldPalaceIncidents)).toBe(true);
    expect(s.coldPalaceIncidents).toHaveLength(0);
  });
});

// ── v20 → v21 migration ──────────────────────────────────────────────────────

describe("save migration v20 → v21 (discriminated union extension)", () => {
  it("v20 save with empty coldPalaceIncidents migrates to v21", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV20Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(loaded.value.state.coldPalaceIncidents).toHaveLength(0);
  });

  it("v20 migration is idempotent: re-save migrated state succeeds", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV20Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, first.value.state, "slot1")));
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
  });
});

// ── Chain migration v17 → v18 → v19 → v20 → v21 ─────────────────────────────

describe("save migration chain v17 → v18 → v19 → v20 → v21", () => {
  it("v17 save migrates through all versions acquiring personnelDecisions, coldPalaceIncidents, and memorials", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const state = loaded.value.state as unknown as Record<string, unknown>;
    // v17→v18: personnelDecisions acquired
    expect(state.personnelDecisions).toBeDefined();
    // v18→v19: coldPalaceIncidents acquired
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(loaded.value.state.coldPalaceIncidents).toHaveLength(0);
    // v19→v20: memorials acquired
    expect(state.memorials).toBeDefined();
    expect(typeof state.memorials).toBe("object");
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
    expect(reloaded.value.state.coldPalaceIncidents).toHaveLength(0);
    const state = reloaded.value.state as unknown as Record<string, unknown>;
    expect(state.personnelDecisions).toBeDefined();
    expect(state.memorials).toBeDefined();
  });
});

// ── Schema validation for critical_illness discriminated union ────────────────

describe("schema validation: critical_illness discriminated union", () => {
  it("rejects critical_illness with invalid status value", () => {
    const s = createNewGameState(db);
    const patch = JSON.parse(JSON.stringify(s));
    patch.coldPalaceIncidents = [{
      id: "cpi_x_1_01",
      residentId: "x",
      effectId: "eff1",
      kind: "critical_illness",
      occurredAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      acknowledged: false,
      status: "invalid_status_value",
    }];
    const storage = createMemoryStorage();
    const env = {
      ...createSaveData(db, s, "slot1"),
      state: patch,
    };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
  });
});

// ── Round-trip with real critical_illness state ───────────────────────────────

describe("round-trip: critical_illness in real GameState", () => {
  it("resolved critical_illness incident survives save/load round-trip", () => {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(r.ok).toBe(true);
    const s = store.getState();
    const effectId = s.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )?.id;
    expect(effectId).toBeDefined();

    const stateWithIncident: GameState = {
      ...s,
      coldPalaceIncidents: [{
        id: `cpi_${REAL_TARGET_ID}_1_01`,
        residentId: REAL_TARGET_ID,
        effectId: effectId!,
        kind: "critical_illness",
        occurredAt: { year: s.calendar.year, month: s.calendar.month, period: s.calendar.period, dayIndex: s.calendar.dayIndex },
        acknowledged: true,
        status: "resolved",
        resolution: "physician",
        resolvedAt: { year: s.calendar.year, month: s.calendar.month, period: s.calendar.period, dayIndex: s.calendar.dayIndex + 5 },
        healthDelta: 15,
      }],
    };

    const storage = createMemoryStorage();
    writeSave(storage, db, stateWithIncident, "slot1");
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const incidents = loaded.value.state.coldPalaceIncidents;
    expect(incidents).toHaveLength(1);
    const inc = incidents[0]!;
    expect(inc.kind).toBe("critical_illness");
    if (inc.kind === "critical_illness") {
      expect(inc.status).toBe("resolved");
      expect(inc.resolution).toBe("physician");
      expect(inc.healthDelta).toBe(15);
    }
  });

  it("pending critical_illness incident survives save/load round-trip", () => {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(r.ok).toBe(true);
    const s = store.getState();
    const effectId = s.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )?.id;
    expect(effectId).toBeDefined();

    const stateWithPending: GameState = {
      ...s,
      coldPalaceIncidents: [{
        id: `cpi_${REAL_TARGET_ID}_${s.calendar.year}_${String(s.calendar.month).padStart(2, "0")}`,
        residentId: REAL_TARGET_ID,
        effectId: effectId!,
        kind: "critical_illness",
        occurredAt: { year: s.calendar.year, month: s.calendar.month, period: s.calendar.period, dayIndex: s.calendar.dayIndex },
        acknowledged: false,
        status: "pending_response",
      }],
    };

    const storage = createMemoryStorage();
    writeSave(storage, db, stateWithPending, "slot1");
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const inc = loaded.value.state.coldPalaceIncidents[0];
    expect(inc?.kind).toBe("critical_illness");
    if (inc?.kind === "critical_illness") {
      expect(inc.status).toBe("pending_response");
      expect(inc.acknowledged).toBe(false);
      expect(inc.resolution).toBeUndefined();
    }
  });
});
