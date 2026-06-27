/**
 * Save format v25 → v26 migration test (Phase 4B-social — Social Simulation Layer).
 *
 * v25 = Phase 4C: borderPressure + frontier assessment (military memorials).
 * v26 = Phase 4B-social: personality + household added to CharacterStanding.
 *
 * Tests:
 *  1. SAVE_FORMAT_VERSION >= 26.
 *  2. v25 save (no personality / household on consort standing) migrates to v26:
 *     personality and household ARE written into standing (not lazy fallback).
 *  3. Migrated state round-trips cleanly.
 *  4. After round-trip, personality + household remain in standing.
 *  5. Official standing does NOT get personality or household in migration.
 *  6. New-game at v26 has personality + household materialised in consort standing.
 *  7. New-game save round-trips at v26.
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
import { PERSONALITY_DEFAULTS, HOUSEHOLD_DEFAULTS } from "../../src/engine/characters/consortAttrs";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

// ── 1. Current version ────────────────────────────────────────────────────────

describe("save format v26", () => {
  it("SAVE_FORMAT_VERSION >= 26 (v25→v26 social simulation layer)", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(26);
  });
});

// ── 2–5. v25 → v26 migration ─────────────────────────────────────────────────

describe("save migration v25 → v26 (personality + household)", () => {
  function makeV25Save(): string {
    const s = createNewGameState(db);
    const stateV25 = structuredClone(s) as unknown as Record<string, unknown>;
    // Strip personality + household from all standing entries to simulate a v25 save.
    const standing = stateV25.standing as Record<string, Record<string, unknown>>;
    for (const entry of Object.values(standing)) {
      delete entry.personality;
      delete entry.household;
    }
    const current = createSaveData(db, s, "slot1");
    return JSON.stringify({
      ...current,
      formatVersion: 25,
      state: stateV25,
      checksum: checksumOf(stateV25 as unknown as GameState),
    });
  }

  it("v25 save missing personality/household migrates to v26 without error", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV25Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
  });

  it("migration WRITES personality into consort standing (not lazy fallback)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV25Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const standing = loaded.value.state.standing["lu_huaijin"];
    expect(standing?.personality).toBeDefined();
    expect(standing?.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("migration WRITES household into consort standing (not lazy fallback)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV25Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const standing = loaded.value.state.standing["lu_huaijin"];
    expect(standing?.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("migrated state round-trips: re-save and reload preserves fields", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV25Save());
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
    expect(second.value.state.standing["lu_huaijin"]?.personality).toEqual(PERSONALITY_DEFAULTS);
    expect(second.value.state.standing["lu_huaijin"]?.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("official standing does NOT get personality or household in migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV25Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const officialStanding = loaded.value.state.standing["wei_sui"];
    expect(officialStanding).toBeDefined();
    expect((officialStanding as unknown as Record<string, unknown>).personality).toBeUndefined();
    expect((officialStanding as unknown as Record<string, unknown>).household).toBeUndefined();
  });
});

// ── 6–7. New game at v26 ─────────────────────────────────────────────────────

describe("new game at v26 — personality + household in consort standing", () => {
  const state = createNewGameState(db);

  it("authored consort standing has personality materialised at new-game", () => {
    const standing = state.standing["lu_huaijin"];
    expect(standing?.personality).toBeDefined();
    expect(standing?.personality).toEqual(PERSONALITY_DEFAULTS);
  });

  it("authored consort standing has household materialised at new-game", () => {
    expect(state.standing["lu_huaijin"]?.household).toEqual(HOUSEHOLD_DEFAULTS);
  });

  it("new-game save round-trips cleanly at v26", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.standing["lu_huaijin"]?.personality).toEqual(PERSONALITY_DEFAULTS);
    expect(loaded.value.state.standing["lu_huaijin"]?.household).toEqual(HOUSEHOLD_DEFAULTS);
  });
});
