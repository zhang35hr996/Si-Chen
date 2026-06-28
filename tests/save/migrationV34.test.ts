/**
 * Save format v33 → v34 migration tests.
 *
 * v34 = 动态事件模板持久化 + 皇嗣性格/成长环境/立绘（PR 1）
 *   新增：templateEventNextSeq, templateEventRecords,
 *         personality, interests, imperialFear, neglect, custodianBond, portraitVariants。
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
import { makeGameTime } from "../../src/engine/calendar/time";
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

/** Build a minimal v33-format save with one heir missing the v34 fields. */
function makeV33SaveWithHeir(sex: "daughter" | "son", hasAdoptiveFather: boolean): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["templateEventNextSeq"];
  delete raw["templateEventRecords"];

  const heir: Record<string, unknown> = {
    id: "heir_000001",
    sex,
    fatherId: null,
    bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"),
    favor: 60,
    legitimate: true,
    petName: "团团",
    education: { scholarship: 10, martial: 8, virtue: 12 },
    health: 70,
    talent: 60,
    diligence: 55,
    ambition: 25,
    closeness: 50,
    support: 20,
    faction: "none",
    lifecycle: "alive",
    healthStatus: "healthy",
  };
  if (hasAdoptiveFather) heir["adoptiveFatherId"] = "lu_huaijin";

  const resources = (raw["resources"] as Record<string, unknown>);
  const bloodline = (resources["bloodline"] as Record<string, unknown>);
  bloodline["heirs"] = [heir];

  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 33,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v33 → v34 migration: template events ──────────────────────────────────────

describe("save migration v33 → v34: template events", () => {
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
});

// ── v33 → v34 migration: heir personality backfill ────────────────────────────

describe("save migration v33 → v34: heir personality backfill", () => {
  it("V34-05: heir without personality gets default values", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33SaveWithHeir("daughter", false));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.personality).toEqual({
      empathy: 50, guile: 50, restraint: 50,
      sociability: 50, assertiveness: 50, curiosity: 50,
    });
    expect(heir.interests).toEqual([]);
    expect(heir.imperialFear).toBe(20);
    expect(heir.neglect).toBe(30);
  });

  it("V34-06: heir with adoptiveFatherId gets custodianBond = 50", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33SaveWithHeir("son", true));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.custodianBond).toBe(50);
  });

  it("V34-07: heir without adoptiveFatherId gets custodianBond = 0", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33SaveWithHeir("daughter", false));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.custodianBond).toBe(0);
  });

  it("V34-08: daughter heir gets girl_ portrait variants", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33SaveWithHeir("daughter", false));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.portraitVariants.baby).toBe("girl_baby1");
    expect(heir.portraitVariants.kid).toMatch(/^girl_kid[1-4]$/);
    expect(heir.portraitVariants.child).toMatch(/^girl_child[1-4]$/);
    expect(heir.portraitVariants.teen).toMatch(/^girl_teen[1-4]$/);
  });

  it("V34-09: son heir gets boy_ portrait variants", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33SaveWithHeir("son", false));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.portraitVariants.baby).toBe("boy_baby1");
    expect(heir.portraitVariants.kid).toMatch(/^boy_kid[1-3]$/);
    expect(heir.portraitVariants.child).toMatch(/^boy_child[1-4]$/);
    expect(heir.portraitVariants.teen).toMatch(/^boy_teen[1-3]$/);
  });

  it("V34-10: migrated v33 state passes gameStateSchema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV33SaveWithHeir("daughter", true));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 5)));
    expect(parsed.success).toBe(true);
  });
});

// ── round-trip ─────────────────────────────────────────────────────────────────

describe("save migration v33 → v34: round-trip", () => {
  it("V34-11: round-trip createSaveData → readSlot (v34) preserves template fields", () => {
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

  it("V34-12: new-game state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    expect(parsed.success).toBe(true);
  });
});
