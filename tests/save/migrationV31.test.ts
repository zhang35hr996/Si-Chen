/**
 * Save format v30 → v31 migration tests.
 *
 * v31 = PR #82: 后宫内部惩戒（haremDisciplineIncidents）
 *       新增字段 haremDisciplineIncidents: HaremDisciplineIncident[]，初始化为 []。
 *
 * Migration chain verified:
 *   v29 → v30 (quarterly settlement) → v31 (harem discipline incidents)
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

it("V31-01: SAVE_FORMAT_VERSION = 31", () => {
  expect(SAVE_FORMAT_VERSION).toBe(31);
});

// ── v30 save builder ──────────────────────────────────────────────────────────

/** Build a v30-format save (no haremDisciplineIncidents field). */
function makeV30Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  // v30 did not have haremDisciplineIncidents
  delete raw.haremDisciplineIncidents;
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 30,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v29 save builder (chain test) ────────────────────────────────────────────

/** Build a v29-format save (no settledQuarterlyPeriods, no haremDisciplineIncidents). */
function makeV29Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw.settledQuarterlyPeriods;
  delete raw.haremDisciplineIncidents;
  const current = createSaveData(db, s, "slot1");
  return JSON.stringify({
    ...current,
    formatVersion: 29,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  });
}

// ── v30 → v31 migration ───────────────────────────────────────────────────────

describe("save migration v30 → v31", () => {
  it("V31-02: v30 save without haremDisciplineIncidents → field initialised to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremDisciplineIncidents).toEqual([]);
  });

  it("V31-03: v30 → v31 migrated state passes schema validation", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });

  it("V31-04: round-trip createSaveData → readSlot (v31) preserves empty haremDisciplineIncidents", () => {
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

// ── v29 → v30 → v31 chain ────────────────────────────────────────────────────

describe("save migration chain v29 → v30 → v31", () => {
  it("V31-05: v29 migrates through both slots to v31 with correct new fields", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("chain migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // Both v30 fields (settledQuarterlyPeriods) and v31 fields (haremDisciplineIncidents) present
    expect(loaded.value.state.settledQuarterlyPeriods).toEqual([]);
    expect(loaded.value.state.haremDisciplineIncidents).toEqual([]);
  });

  it("V31-06: v29 chain migration produces valid schema state", () => {
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
