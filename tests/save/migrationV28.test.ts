/**
 * Group M: save format v27 → v28 migration tests (PUNISH-4G-A: peakFavor).
 *
 * v27 = 称谓系统权威化（位分 ID 全量重映射：fenghou→huanghou, jun→fu, …）
 * v28 = PUNISH-4G-A: CharacterStanding.peakFavor (historical max favor)
 *
 * These tests exercise the real readSlot() → MIGRATIONS[27] → gameStateSchema path.
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  CORRUPT_KEY_PREFIX,
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

// ── v27 save builder ──────────────────────────────────────────────────────────

/**
 * Build a v27-format save: valid new-game state with peakFavor stripped from
 * all standing entries and formatVersion set to 27.
 */
function makeV27Save(stateOverrides?: (raw: Record<string, unknown>) => void): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;

  // Strip peakFavor from all standing entries (v27 didn't have it)
  const standing = raw.standing as Record<string, Record<string, unknown>>;
  for (const st of Object.values(standing)) {
    delete st.peakFavor;
  }

  stateOverrides?.(raw);

  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 27,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── Current version ───────────────────────────────────────────────────────────

describe("save format v28", () => {
  it("SAVE_FORMAT_VERSION >= 28", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(28);
  });
});

// ── v27 → v28 migration ───────────────────────────────────────────────────────

describe("save migration v27 → v28", () => {
  it("v27 save (no peakFavor): migrated — every standing entry gets peakFavor = favor", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV27Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    for (const [id, st] of Object.entries(loaded.value.state.standing)) {
      expect(st.peakFavor, `${id}: peakFavor should be defined`).toBeDefined();
      expect(st.peakFavor, `${id}: peakFavor === favor`).toBe(st.favor);
    }
  });

  it("v27 save: migrated state passes gameStateSchema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV27Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    expect(parsed.success).toBe(true);
  });

  it("v27 save with pre-existing peakFavor > favor: preserved (not overwritten)", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV27Save((raw) => {
        const standing = raw.standing as Record<string, Record<string, unknown>>;
        const first = Object.keys(standing)[0]!;
        const st = standing[first]!;
        // Manually re-add peakFavor > favor before save (simulating partial migration)
        const favor = st.favor as number;
        st.peakFavor = favor + 30;
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const firstId = Object.keys(loaded.value.state.standing)[0]!;
    const st = loaded.value.state.standing[firstId]!;
    expect(st.peakFavor).toBeGreaterThan(st.favor);
  });

  it("checksum is valid after migration (readSlot succeeds)", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV27Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
  });

  it("input envelope is not mutated by migration", () => {
    const saved = makeV27Save();
    const original = JSON.parse(saved) as Record<string, unknown>;
    const originalStanding = structuredClone(
      (original.state as Record<string, unknown>).standing,
    ) as Record<string, Record<string, unknown>>;

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, saved);
    readSlot(storage, db, "slot1", { now: () => 0 });

    const reRead = JSON.parse(
      storage.get(`${SAVE_KEY_PREFIX}slot1`) ?? "{}",
    ) as Record<string, unknown>;
    const reStanding = (reRead.state as Record<string, unknown>).standing as Record<
      string,
      Record<string, unknown>
    >;

    // The stored JSON should not have been mutated
    for (const [id, st] of Object.entries(originalStanding)) {
      expect(reStanding[id]).not.toHaveProperty("peakFavor");
      expect(reStanding[id]!.favor).toBe(st.favor);
    }
  });

  it("idempotent round-trip: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV27Save());
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
    for (const st of Object.values(second.value.state.standing)) {
      expect(st.peakFavor).toBeGreaterThanOrEqual(st.favor);
    }
  });

  it("corrupt v28 save (peakFavor < favor) is quarantined and not returned", () => {
    const storage = createMemoryStorage();
    // Build a v28-format save with an invalid peakFavor < favor
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;
    const standing = raw.standing as Record<string, Record<string, unknown>>;
    const firstId = Object.keys(standing)[0]!;
    const st = standing[firstId]!;
    st.peakFavor = (st.favor as number) - 10; // invalid: below favor

    const env = {
      ...createSaveData(db, s, "slot1"),
      formatVersion: 28,
      state: raw,
      checksum: checksumOf(raw as unknown as GameState),
    };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));

    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(false);
    const quarantineKeys = storage.keys().filter((k) => k.startsWith(CORRUPT_KEY_PREFIX));
    expect(quarantineKeys.length).toBeGreaterThan(0);
  });
});

// ── Chain from v24 → v25 → v26 → v27 → v28 ─────────────────────────────────

describe("save migration chain v24 → v28", () => {
  function makeV24Save(): string {
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;

    // v24: no borderPressure, no frontierAssessments, no personality/household, no peakFavor
    const resources = raw.resources as Record<string, unknown>;
    const nation = resources.nation as Record<string, unknown>;
    delete nation.borderPressure;
    delete raw.frontierAssessments;

    const standing = raw.standing as Record<string, Record<string, unknown>>;
    for (const st of Object.values(standing)) {
      delete st.peakFavor;
      delete st.personality;
      delete st.household;
    }

    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 24,
      state: raw,
      checksum: checksumOf(raw as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v24 save migrates through v25→v26→v27→v28: acquires borderPressure + frontierAssessments + personality + peakFavor", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV24Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.resources.nation.borderPressure).toBe(35);
    expect(Array.isArray(loaded.value.state.frontierAssessments)).toBe(true);
    for (const [id, st] of Object.entries(loaded.value.state.standing)) {
      expect(st.peakFavor, `${id}: peakFavor after chain migration`).toBeDefined();
      expect(st.peakFavor).toBe(st.favor);
    }
  });
});
