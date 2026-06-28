/**
 * Save format v31 → v32 migration tests.
 *
 * v32 = PR #82: 后宫内部惩戒（haremDisciplineIncidents）
 *       新增字段 haremDisciplineIncidents: HaremDisciplineIncident[]，初始化为 []。
 * v33 = Phase 5A-3a: pendingIntrigueNotifications → haremIntrigueReports + settledHaremIntriguePeriods
 *
 * Migration chain verified:
 *   v29 → v30 (quarterly settlement) → v31 (harem intrigue) → v32 (harem discipline incidents)
 *     → v33 (haremIntrigueReports + settledHaremIntriguePeriods)
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
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

// ── version check ─────────────────────────────────────────────────────────────

it("V32-01: SAVE_FORMAT_VERSION >= 32", () => {
  expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(32);
});

// ── v31 save builder ──────────────────────────────────────────────────────────

/** Build a v31-format save (no haremDisciplineIncidents, no v33 fields). */
function makeV31Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  // v31 did not have haremDisciplineIncidents or v33 fields
  delete raw["haremDisciplineIncidents"];
  delete raw["haremIntrigueReports"];
  delete raw["settledHaremIntriguePeriods"];
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 31,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v29 save builder (chain test) ────────────────────────────────────────────

/** Build a v29-format save (no settledQuarterlyPeriods, no haremDisciplineIncidents, no haremSchemes). */
function makeV29Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["settledQuarterlyPeriods"];
  delete raw["haremSchemes"];
  delete raw["haremIncidents"];
  delete raw["haremIntrigueReports"];
  delete raw["settledHaremIntriguePeriods"];
  delete raw["haremDisciplineIncidents"];
  const current = createSaveData(db, s, "slot1");
  return JSON.stringify({
    ...current,
    formatVersion: 29,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  });
}

// ── v31 → v32 migration ───────────────────────────────────────────────────────

describe("save migration v31 → v32", () => {
  it("V32-02: v31 save without haremDisciplineIncidents → field initialised to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV31Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremDisciplineIncidents).toEqual([]);
  });

  it("V32-03: v31 → v32+ migrated state passes schema validation", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV31Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });

  it("V32-04: round-trip createSaveData → readSlot preserves empty haremDisciplineIncidents", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremDisciplineIncidents).toEqual([]);
  });
});

// ── v29 → v30 → v31 → v32 → v33 chain ───────────────────────────────────────

describe("save migration chain v29 → v30 → v31 → v32 → v33", () => {
  it("V32-05: v29 migrates through all steps with correct new fields", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("chain migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // v30 fields
    expect(loaded.value.state.settledQuarterlyPeriods).toEqual([]);
    // v31 fields (intrigue arrays)
    expect(Array.isArray(loaded.value.state.haremSchemes)).toBe(true);
    expect(Array.isArray(loaded.value.state.haremIncidents)).toBe(true);
    // v32 fields
    expect(loaded.value.state.haremDisciplineIncidents).toEqual([]);
    // v33 fields (renamed from pendingIntrigueNotifications)
    expect(Array.isArray(loaded.value.state.haremIntrigueReports)).toBe(true);
    expect(Array.isArray(loaded.value.state.settledHaremIntriguePeriods)).toBe(true);
  });

  it("V32-06: v29 chain migration produces valid schema state", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });
});
