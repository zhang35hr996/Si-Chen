/**
 * Group H: save format v22 → v23 migration tests (Phase 4B: 财政奏折框架).
 *
 * v22 = PUNISH-4E: 长门宫探视（coldPalaceInterventions）
 * v23 = Phase 4B: 财政奏折框架（treasuryLedger 回填 + pending disaster 奏折补 treasuryDelta）
 *
 * Chain: v19→v20 (memorials) → v20→v21 (critical_illness) → v21→v22 (interventions) → v22→v23 (treasuryLedger)
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
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const AT = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

// ── 辅助：构造 v22 存档 ────────────────────────────────────────────────────────

function makeV22Save(stateOverrides?: (s: Record<string, unknown>) => void): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  // v22 state: has memorials, coldPalaceInterventions, but no treasuryLedger yet
  delete raw.treasuryLedger;
  stateOverrides?.(raw);
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 22,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── Current version ───────────────────────────────────────────────────────────

describe("save format v23", () => {
  it("SAVE_FORMAT_VERSION ≥ 23", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(23);
  });

  it("new game state has treasuryLedger as empty array", () => {
    const s = createNewGameState(db);
    expect(Array.isArray(s.treasuryLedger)).toBe(true);
    expect(s.treasuryLedger).toHaveLength(0);
  });
});

// ── v22 → v23 migration ───────────────────────────────────────────────────────

describe("save migration v22 → v23", () => {
  it("v22 save backfills treasuryLedger to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV22Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.treasuryLedger)).toBe(true);
    expect(loaded.value.state.treasuryLedger).toHaveLength(0);
  });

  it("pending disaster memorial gets treasuryDelta on options", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV22Save((raw) => {
        (raw.memorials as Record<string, unknown>) = {
          "mem_000001": {
            id: "mem_000001",
            category: "disaster",
            status: "pending",
            createdAt: AT,
            sourceId: "disaster:jiangnan:1",
            title: "江南灾情奏报",
            summary: "灾情。",
            payload: {
              category: "disaster",
              regionId: "jiangnan",
              severity: "minor",
              options: [
                { id: "relief", label: "开仓赈济", effects: [] },
                { id: "tax_remit", label: "蠲免赋税", effects: [] },
                { id: "ignore", label: "不予理会", effects: [] },
              ],
            },
          },
        };
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const m = loaded.value.state.memorials["mem_000001"]!;
    expect(m.payload.category).toBe("disaster");
    if (m.payload.category !== "disaster") return;
    const relief = m.payload.options.find((o) => o.id === "relief")!;
    const taxRemit = m.payload.options.find((o) => o.id === "tax_remit")!;
    const ignore = m.payload.options.find((o) => o.id === "ignore")!;

    expect(relief.treasuryDelta).toBe(-400);
    expect(taxRemit.treasuryDelta).toBe(-250);
    expect(ignore.treasuryDelta).toBeUndefined();
  });

  it("pending major disaster gets correct costs: relief -900, tax_remit -600", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV22Save((raw) => {
        (raw.memorials as Record<string, unknown>) = {
          "mem_000001": {
            id: "mem_000001",
            category: "disaster",
            status: "pending",
            createdAt: AT,
            sourceId: "disaster:hebei:1",
            title: "河北灾情奏报",
            summary: "大灾。",
            payload: {
              category: "disaster",
              regionId: "hebei",
              severity: "major",
              options: [
                { id: "relief", label: "赈济", effects: [] },
                { id: "tax_remit", label: "蠲免", effects: [] },
                { id: "ignore", label: "忽视", effects: [] },
              ],
            },
          },
        };
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const m = loaded.value.state.memorials["mem_000001"]!;
    if (m.payload.category !== "disaster") return;
    const relief = m.payload.options.find((o) => o.id === "relief")!;
    const taxRemit = m.payload.options.find((o) => o.id === "tax_remit")!;
    expect(relief.treasuryDelta).toBe(-900);
    expect(taxRemit.treasuryDelta).toBe(-600);
  });

  it("resolved disaster memorial does NOT get treasuryDelta on options", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV22Save((raw) => {
        (raw.memorials as Record<string, unknown>) = {
          "mem_000001": {
            id: "mem_000001",
            category: "disaster",
            status: "resolved",
            createdAt: AT,
            resolvedAt: AT,
            resolution: "relief",
            sourceId: "disaster:jiangnan:1",
            title: "江南灾情奏报",
            summary: "灾情。",
            payload: {
              category: "disaster",
              regionId: "jiangnan",
              severity: "minor",
              options: [
                { id: "relief", label: "赈济", effects: [] },
                { id: "tax_remit", label: "蠲免", effects: [] },
                { id: "ignore", label: "忽视", effects: [] },
              ],
            },
          },
        };
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const m = loaded.value.state.memorials["mem_000001"]!;
    if (m.payload.category !== "disaster") return;
    const relief = m.payload.options.find((o) => o.id === "relief")!;
    expect(relief.treasuryDelta).toBeUndefined();
  });

  it("existing treasuryDelta not overwritten", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV22Save((raw) => {
        (raw.memorials as Record<string, unknown>) = {
          "mem_000001": {
            id: "mem_000001",
            category: "disaster",
            status: "pending",
            createdAt: AT,
            sourceId: "disaster:jiangnan:1",
            title: "江南",
            summary: "灾情。",
            payload: {
              category: "disaster",
              regionId: "jiangnan",
              severity: "minor",
              options: [
                { id: "relief", label: "赈济", effects: [], treasuryDelta: -999 },
                { id: "tax_remit", label: "蠲免", effects: [] },
                { id: "ignore", label: "忽视", effects: [] },
              ],
            },
          },
        };
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const m = loaded.value.state.memorials["mem_000001"]!;
    if (m.payload.category !== "disaster") return;
    const relief = m.payload.options.find((o) => o.id === "relief")!;
    expect(relief.treasuryDelta).toBe(-999);
  });

  it("migration is idempotent: re-saving and reloading migrated state works", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV22Save());
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
    expect(second.value.state.treasuryLedger).toEqual([]);
  });

  it("checksum is correct after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV22Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
  });
});

// ── v19 → v20 → v21 → v22 → v23 chain ───────────────────────────────────────

describe("save migration chain v19 → v20 → v21 → v22 → v23", () => {
  function makeV19Save(): string {
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;
    delete raw.memorials;
    delete raw.treasuryLedger;
    delete raw.coldPalaceIncidents;
    delete raw.coldPalaceInterventions;
    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 19,
      state: raw,
      checksum: checksumOf(raw as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v19 save migrates through all versions: acquires memorials, incidents, interventions, and treasuryLedger", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV19Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.memorials).toEqual({});
    expect(Array.isArray(loaded.value.state.coldPalaceIncidents)).toBe(true);
    expect(Array.isArray(loaded.value.state.coldPalaceInterventions)).toBe(true);
    expect(Array.isArray(loaded.value.state.treasuryLedger)).toBe(true);
    expect(loaded.value.state.treasuryLedger).toHaveLength(0);
  });

  it("v19 chain round-trip: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV19Save());
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
    expect(second.value.state.memorials).toEqual({});
    expect(second.value.state.treasuryLedger).toEqual([]);
  });
});
