/**
 * Save format v34 → v35 migration tests.
 *
 * v35 = 宫斗调查案件（Phase 5B-1A）：新增 haremInvestigationCases: [] 字段。
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

// ── version check ──────────────────────────────────────────────────────────────

it("V35-01: SAVE_FORMAT_VERSION = 35", () => {
  expect(SAVE_FORMAT_VERSION).toBe(35);
});

// ── v34 save builder ───────────────────────────────────────────────────────────

/** Build a v34-format save (no haremInvestigationCases). */
function makeV34Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["haremInvestigationCases"];
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 34,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v34 → v35 migration ────────────────────────────────────────────────────────

describe("save migration v34 → v35", () => {
  it("V35-02: v34 save without haremInvestigationCases → field initialised to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV34Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremInvestigationCases).toEqual([]);
  });

  it("V35-03: v34 → v35 migrated state passes schema validation", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV34Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });

  it("V35-04: round-trip createSaveData → readSlot (v35) preserves haremInvestigationCases", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremInvestigationCases).toEqual([]);
  });
});
