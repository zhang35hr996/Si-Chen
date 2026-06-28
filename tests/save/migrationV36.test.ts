/**
 * Save format v35 → v36 migration tests.
 *
 * v36 = 宫斗调查执行层（Phase 5B-2）：新增
 *   haremInvestigationTasks: {}
 *   haremInvestigationLeads: {}
 *   haremInvestigationNextSeq: 1
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

it("V36-01: SAVE_FORMAT_VERSION = 36", () => {
  expect(SAVE_FORMAT_VERSION).toBe(36);
});

// ── v35 save builder ───────────────────────────────────────────────────────────

/** Build a v35-format save (no investigation tasks/leads/seq). */
function makeV35Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["haremInvestigationTasks"];
  delete raw["haremInvestigationLeads"];
  delete raw["haremInvestigationNextSeq"];
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 35,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v35 → v36 migration ────────────────────────────────────────────────────────

describe("save migration v35 → v36", () => {
  it("V36-02: v35 save without investigation fields → all three initialised", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV35Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremInvestigationTasks).toEqual({});
    expect(loaded.value.state.haremInvestigationLeads).toEqual({});
    expect(loaded.value.state.haremInvestigationNextSeq).toBe(1);
  });

  it("V36-03: v35 → v36 migrated state passes schema validation", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV35Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });

  it("V36-04: round-trip createSaveData → readSlot (v36) preserves investigation fields", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.haremInvestigationTasks).toEqual({});
    expect(loaded.value.state.haremInvestigationLeads).toEqual({});
    expect(loaded.value.state.haremInvestigationNextSeq).toBe(1);
  });
});
