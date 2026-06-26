/**
 * Group L: save format v24 → v25 migration tests (Phase 4C: borderPressure + frontierAssessments).
 *
 * v24 = PUNISH-4F: 长门宫精神失常（slot 23, merged before Phase 4C）
 * v25 = Phase 4C: 边患压力 + 年度边情评估（borderPressure + frontierAssessments）
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

// ── v24 save builder ──────────────────────────────────────────────────────────

/**
 * Build a v24-format save (has treasuryLedger from Phase 4B, but no borderPressure / frontierAssessments).
 */
function makeV24Save(stateOverrides?: (s: Record<string, unknown>) => void): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;

  // v24 state: no borderPressure, no frontierAssessments
  const resources = raw.resources as Record<string, unknown>;
  const nation = resources.nation as Record<string, unknown>;
  delete nation.borderPressure;
  delete raw.frontierAssessments;

  stateOverrides?.(raw);

  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 24,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── Current version ───────────────────────────────────────────────────────────

describe("save format v25", () => {
  it("SAVE_FORMAT_VERSION >= 25", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(25);
  });
});

// ── v24 → v25 migration ───────────────────────────────────────────────────────

describe("save migration v24 → v25", () => {
  it("v24 save with no borderPressure: migrated to 35", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV24Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.resources.nation.borderPressure).toBe(35);
  });

  it("v24 save with no frontierAssessments: migrated to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV24Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Array.isArray(loaded.value.state.frontierAssessments)).toBe(true);
    expect(loaded.value.state.frontierAssessments).toHaveLength(0);
  });

  it("v24 save with existing borderPressure=50: preserved (not overwritten)", () => {
    const storage = createMemoryStorage();
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV24Save((raw) => {
        const resources = raw.resources as Record<string, unknown>;
        const nation = resources.nation as Record<string, unknown>;
        nation.borderPressure = 50;
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.resources.nation.borderPressure).toBe(50);
  });

  it("v24 save with existing frontierAssessments: preserved", () => {
    const storage = createMemoryStorage();
    const mockAssessment = {
      id: "frontier_assessment:1",
      year: 1,
      assessedAt: { year: 1, month: 7, period: "early", dayIndex: 180 },
      theaterId: "northern_frontier",
      pressureBefore: 35,
      pressureDelta: 5,
      pressureAfter: 40,
      militaryAtAssessment: 50,
      governanceAtAssessment: 50,
      publicSupportAtAssessment: 50,
      severity: "watch",
      generation: { status: "generated", memorialId: "mem_000001" },
    };
    storage.set(
      `${SAVE_KEY_PREFIX}slot1`,
      makeV24Save((raw) => {
        (raw.frontierAssessments as unknown) = [mockAssessment];
        // Add a military memorial to satisfy the frontier validator
        const memorials = raw.memorials as Record<string, unknown>;
        memorials["mem_000001"] = {
          id: "mem_000001",
          category: "military",
          status: "pending",
          createdAt: { year: 1, month: 7, period: "early", dayIndex: 180 },
          sourceId: "military:border_fortification:northern_frontier:1",
          title: "边务奏报",
          summary: "请旨。",
          payload: {
            category: "military",
            matter: "border_fortification",
            urgency: "routine",
            theaterId: "northern_frontier",
            pressureAtCreation: 40,
            militaryAtCreation: 50,
            options: [
              { id: "fortify_passes", label: "增修关隘", effects: [{ type: "resource", pillar: "nation", field: "borderPressure", delta: -7 }], treasuryDelta: -1200 },
              { id: "rotate_garrison", label: "轮戍边军", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 5 }], treasuryDelta: -700 },
              { id: "local_levy", label: "就地募兵", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 4 }] },
            ],
          },
        };
      }),
    );
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.frontierAssessments).toHaveLength(1);
    expect(loaded.value.state.frontierAssessments[0]!.year).toBe(1);
  });

  it("checksum is correct after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV24Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
  });

  it("idempotent round-trip: migrated state saves and reloads cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV24Save());
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
    expect(second.value.state.resources.nation.borderPressure).toBe(35);
    expect(second.value.state.frontierAssessments).toEqual([]);
  });
});

// ── Chain from v23 → v24 → v25 ───────────────────────────────────────────────

describe("save migration chain v23 → v25", () => {
  function makeV23Save(): string {
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;

    // v23: has treasuryLedger (from Phase 4B), but no borderPressure, no frontierAssessments
    const resources = raw.resources as Record<string, unknown>;
    const nation = resources.nation as Record<string, unknown>;
    delete nation.borderPressure;
    delete raw.frontierAssessments;

    const current = createSaveData(db, s, "slot1");
    const env = {
      ...current,
      formatVersion: 23,
      state: raw,
      checksum: checksumOf(raw as unknown as GameState),
    };
    return JSON.stringify(env);
  }

  it("v23 save migrates to v25: acquires borderPressure and frontierAssessments", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV23Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.resources.nation.borderPressure).toBe(35);
    expect(Array.isArray(loaded.value.state.frontierAssessments)).toBe(true);
    expect(loaded.value.state.frontierAssessments).toHaveLength(0);
  });
});
