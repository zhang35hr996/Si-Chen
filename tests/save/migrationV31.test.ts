/**
 * Migration v30 → v31: haremSchemes / haremIncidents / haremIntrigueReports
 *
 * Phase 5A-2 adds haremSchemes, haremIncidents to GameState.
 * Phase 5A-3a (v33) renames pendingIntrigueNotifications → haremIntrigueReports + settledHaremIntriguePeriods.
 * After loading a v30 save through the full chain (v31→v32→v33), the state should have
 * haremIntrigueReports = [] and settledHaremIntriguePeriods = [].
 *
 * Migration chain verified:
 *   v28 → v29 (haremAdminReviews) → v30 (quarterly settlement) → v31 (harem intrigue)
 *     → v32 (discipline) → v33 (haremIntrigueReports + settledHaremIntriguePeriods)
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

// ── v30 save builder ──────────────────────────────────────────────────────────

/** Build a v30-format save. A v30 save doesn't have haremSchemes/haremIncidents/intrigue fields. */
function makeV30Save(stateOverrides?: (raw: Record<string, unknown>) => void): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;

  // Strip fields that didn't exist in v30
  delete raw["haremSchemes"];
  delete raw["haremIncidents"];
  delete raw["haremIntrigueReports"];
  delete raw["settledHaremIntriguePeriods"];
  delete raw["haremDisciplineIncidents"];

  stateOverrides?.(raw);

  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 30,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── Current version ───────────────────────────────────────────────────────────

describe("save format v31+", () => {
  it("SAVE_FORMAT_VERSION >= 31", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(31);
  });
});

// ── v30 → v31+ migration ──────────────────────────────────────────────────────

describe("save migration v30 → v31+", () => {
  it("v30 save (no haremSchemes) migrates: haremSchemes = []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.haremSchemes)).toBe(true);
    expect(loaded.value.state.haremSchemes).toHaveLength(0);
  });

  it("v30 save (no haremIncidents) migrates: haremIncidents = []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.haremIncidents)).toBe(true);
    expect(loaded.value.state.haremIncidents).toHaveLength(0);
  });

  it("v30 save migrates: haremIntrigueReports = [] (v33 field)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.haremIntrigueReports)).toBe(true);
    expect(loaded.value.state.haremIntrigueReports).toHaveLength(0);
  });

  it("v30 save migrates: settledHaremIntriguePeriods = [] (v33 field)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.settledHaremIntriguePeriods)).toBe(true);
    expect(loaded.value.state.settledHaremIntriguePeriods).toHaveLength(0);
  });

  it("migrated state passes gameStateSchema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema error:", parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  it("checksum is valid after migration (readSlot succeeds)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
  });

  it("v30 save with pre-existing haremSchemes = []: existing value preserved", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV30Save((raw) => {
        // Simulate a partially-migrated save that already has the field
        raw["haremSchemes"] = [];
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremSchemes).toHaveLength(0);
  });

  it("idempotent round-trip: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV30Save());
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
    expect(Array.isArray(second.value.state.haremSchemes)).toBe(true);
    expect(Array.isArray(second.value.state.haremIncidents)).toBe(true);
    expect(Array.isArray(second.value.state.haremIntrigueReports)).toBe(true);
    expect(Array.isArray(second.value.state.settledHaremIntriguePeriods)).toBe(true);
  });

  it("input envelope is not mutated by migration", () => {
    const saved = makeV30Save();
    const original = JSON.parse(saved) as Record<string, unknown>;
    const originalState = structuredClone(original.state) as Record<string, unknown>;

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, saved);
    readSlot(storage, db, "slot1", { now: () => 0 });

    const reRead = JSON.parse(
      storage.get(`${SAVE_KEY_PREFIX}slot1`) ?? "{}",
    ) as Record<string, unknown>;
    const reState = reRead.state as Record<string, unknown>;

    // Original stored JSON should not have been mutated
    expect(originalState["haremSchemes"]).toBeUndefined();
    expect(reState["haremSchemes"]).toBeUndefined();
  });
});

// ── Chain migration v28 → v29 → v30 → v31 → v32 → v33 ──────────────────────

describe("save migration chain v28 → v29 → v30 → v31 → v32 → v33", () => {
  function makeV28Save(): string {
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;

    // Strip v29+ fields
    delete raw["haremAdminReviews"];
    delete raw["settledQuarterlyPeriods"];
    delete raw["haremSchemes"];
    delete raw["haremIncidents"];
    delete raw["haremIntrigueReports"];
    delete raw["settledHaremIntriguePeriods"];
    delete raw["haremDisciplineIncidents"];

    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 28,
      state: raw,
      checksum: checksumOf(raw as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v28 save migrates through chain: acquires haremSchemes + haremIncidents + haremIntrigueReports + settledHaremIntriguePeriods", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV28Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const state = loaded.value.state;
    expect(Array.isArray(state.haremSchemes)).toBe(true);
    expect(Array.isArray(state.haremIncidents)).toBe(true);
    expect(Array.isArray(state.haremIntrigueReports)).toBe(true);
    expect(Array.isArray(state.settledHaremIntriguePeriods)).toBe(true);
    expect(state.haremSchemes).toHaveLength(0);
    expect(state.haremIncidents).toHaveLength(0);
    expect(state.haremIntrigueReports).toHaveLength(0);
    expect(state.settledHaremIntriguePeriods).toHaveLength(0);
  });

  it("v28 save migrates through chain: haremAdminReviews initialised (v29 step)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV28Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // haremAdminReviews should exist (added by v28→v29 migration)
    expect(Array.isArray(loaded.value.state.haremAdminReviews)).toBe(true);
  });

  it("v28 save migrates through chain: settledQuarterlyPeriods initialised (v30 step)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV28Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // settledQuarterlyPeriods should exist (added by v29→v30 migration)
    expect(Array.isArray(loaded.value.state.settledQuarterlyPeriods)).toBe(true);
  });

  it("v28 → v33 chain: passes gameStateSchema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV28Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    expect(parsed.success).toBe(true);
  });
});

// ── New-game state has all v31+ fields ───────────────────────────────────────

describe("v31+ new-game state", () => {
  it("createNewGameState includes haremSchemes = []", () => {
    const state = createNewGameState(db);
    expect(state.haremSchemes).toEqual([]);
  });

  it("createNewGameState includes haremIncidents = []", () => {
    const state = createNewGameState(db);
    expect(state.haremIncidents).toEqual([]);
  });

  it("createNewGameState includes haremIntrigueReports = []", () => {
    const state = createNewGameState(db);
    expect(state.haremIntrigueReports).toEqual([]);
  });

  it("createNewGameState includes settledHaremIntriguePeriods = []", () => {
    const state = createNewGameState(db);
    expect(state.settledHaremIntriguePeriods).toEqual([]);
  });

  it("new-game state passes gameStateSchema", () => {
    const state = createNewGameState(db);
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
  });
});
