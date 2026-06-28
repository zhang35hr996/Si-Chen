/**
 * Save format v33 → v34 migration tests.
 *
 * v34 = event template system: adds templateEventNextSeq (number) and
 *       templateEventRecords (Record<string, TemplateEventRecord>).
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

it("V34-01: SAVE_FORMAT_VERSION = 34", () => {
  expect(SAVE_FORMAT_VERSION).toBe(34);
});

// ── v33 save builder ──────────────────────────────────────────────────────────

/** Build a v33-format save (no templateEventNextSeq / templateEventRecords). */
function makeV33Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["templateEventNextSeq"];
  delete raw["templateEventRecords"];
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 33,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v33 → v34 migration ───────────────────────────────────────────────────────

describe("save migration v33 → v34", () => {
  it("V34-02: v33 save without templateEventNextSeq → field initialised to 0", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.templateEventNextSeq).toBe(0);
  });

  it("V34-03: v33 save without templateEventRecords → field initialised to {}", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.templateEventRecords).toEqual({});
  });

  it("V34-04: v33 → v34 migrated state passes schema validation", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });

  it("V34-05: round-trip createSaveData → readSlot (v34) preserves template fields", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.templateEventNextSeq).toBe(0);
    expect(loaded.value.state.templateEventRecords).toEqual({});
  });
});
