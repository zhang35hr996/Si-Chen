/**
 * Save format v29 → v30 migration tests.
 *
 * v29 = PR #76: 六宫年度例核（haremAdminReviews）
 * v30 = PR #80: 季度财政结算快照字段扩充
 *       PR #79 格式的 quarterly_settlement_report（无 periodKey 等字段）被删除；
 *       其 sourceId 写入 settledQuarterlyPeriods；settledQuarterlyPeriods 字段初始化。
 *
 * Migration chain verified:
 *   v28 → v29 (haremAdminReviews) → v30 (quarterly settlement)
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

// ── v29 save builder ──────────────────────────────────────────────────────────

/**
 * Build a v29-format save. Optionally inject PR #79-style quarterly_settlement_report
 * memorials (missing periodKey and other new fields).
 */
function makeV29Save(opts?: {
  withQuarterlyMemorial?: boolean;
  quarterlySourceId?: string;
}): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;

  // v29 did not have settledQuarterlyPeriods
  delete (raw as Record<string, unknown>).settledQuarterlyPeriods;

  if (opts?.withQuarterlyMemorial) {
    const sourceId = opts.quarterlySourceId ?? "quarterly_settlement:2:1";
    const memorials = raw.memorials as Record<string, unknown>;
    memorials["mem_000099"] = {
      id: "mem_000099",
      category: "treasury",
      status: "pending",
      createdAt: { year: 2, month: 1, period: "early", dayIndex: 1 },
      sourceId,
      title: "冬税入库·季度财政简录",
      summary: "户部尚书奏报：…",
      // PR #79 payload shape: no periodKey, no snapshot fields
      payload: {
        category: "treasury",
        matter: "quarterly_settlement_report",
        season: "冬",
        options: [{ id: "acknowledge", label: "已阅", effects: [] }],
      },
    };
  }

  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 29,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v28 save builder (for chain test) ────────────────────────────────────────

function makeV28Save(opts?: { withQuarterlyMemorial?: boolean; quarterlySourceId?: string }): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete (raw as Record<string, unknown>).settledQuarterlyPeriods;
  delete (raw as Record<string, unknown>).haremAdminReviews;

  if (opts?.withQuarterlyMemorial) {
    const sourceId = opts.quarterlySourceId ?? "quarterly_settlement:2:1";
    const memorials = raw.memorials as Record<string, unknown>;
    memorials["mem_000099"] = {
      id: "mem_000099",
      category: "treasury",
      status: "pending",
      createdAt: { year: 2, month: 1, period: "early", dayIndex: 1 },
      sourceId,
      title: "冬税入库·季度财政简录",
      summary: "…",
      payload: { category: "treasury", matter: "quarterly_settlement_report", season: "冬", options: [{ id: "acknowledge", label: "已阅", effects: [] }] },
    };
  }

  const current = createSaveData(db, s, "slot1");
  return JSON.stringify({ ...current, formatVersion: 28, state: raw, checksum: checksumOf(raw as unknown as GameState) });
}

// ── Version check ─────────────────────────────────────────────────────────────

describe("save format v30", () => {
  it("SAVE_FORMAT_VERSION === 31", () => {
    expect(SAVE_FORMAT_VERSION).toBe(31);
  });
});

// ── v29 → v30 migration ───────────────────────────────────────────────────────

describe("save migration v29 → v30", () => {
  it("v29 save without quarterly memorials: settledQuarterlyPeriods initialised to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.settledQuarterlyPeriods).toEqual([]);
  });

  it("v29 save with PR #79-style quarterly memorial: memorial is removed after migration", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save({ withQuarterlyMemorial: true }));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const hasOldMemorial = Object.values(loaded.value.state.memorials).some(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    );
    expect(hasOldMemorial).toBe(false);
  });

  it("v29 save with PR #79-style quarterly memorial: sourceId preserved in settledQuarterlyPeriods", () => {
    const sourceId = "quarterly_settlement:2:1";
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save({ withQuarterlyMemorial: true, quarterlySourceId: sourceId }));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.settledQuarterlyPeriods).toContain(sourceId);
  });

  it("v29 save migrates to valid gameStateSchema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save({ withQuarterlyMemorial: true }));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    if (!parsed.success) console.error("schema issues:", JSON.stringify(parsed.error.issues.slice(0, 3)));
    expect(parsed.success).toBe(true);
  });

  it("v29 clean save round-trips cleanly", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV29Save());
    const first = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, first.value.state, "slot1")));
    const second = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(second.ok).toBe(true);
  });

  it("duplicate sourceId in settledQuarterlyPeriods: not added twice", () => {
    const sourceId = "quarterly_settlement:2:1";
    const storage = createMemoryStorage();
    const s = createNewGameState(db);
    const raw = structuredClone(s) as unknown as Record<string, unknown>;
    raw.settledQuarterlyPeriods = [sourceId];
    const memorials = raw.memorials as Record<string, unknown>;
    memorials["mem_000099"] = {
      id: "mem_000099",
      category: "treasury",
      status: "pending",
      createdAt: { year: 2, month: 1, period: "early", dayIndex: 1 },
      sourceId,
      title: "冬税入库·季度财政简录",
      summary: "…",
      payload: { category: "treasury", matter: "quarterly_settlement_report", season: "冬", options: [{ id: "acknowledge", label: "已阅", effects: [] }] },
    };
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 29, state: raw, checksum: checksumOf(raw as unknown as GameState) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const count = loaded.value.state.settledQuarterlyPeriods.filter((id) => id === sourceId).length;
    expect(count).toBe(1);
  });
});

// ── v28 → v29 → v30 chain ────────────────────────────────────────────────────

describe("save migration chain v28 → v29 → v30", () => {
  it("v28 save with quarterly memorial migrates through both steps: memorial removed, sourceId preserved", () => {
    const sourceId = "quarterly_settlement:2:1";
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV28Save({ withQuarterlyMemorial: true, quarterlySourceId: sourceId }));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    if (!loaded.ok) console.error("chain error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const hasOldMemorial = Object.values(loaded.value.state.memorials).some(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    );
    expect(hasOldMemorial).toBe(false);
    expect(loaded.value.state.settledQuarterlyPeriods).toContain(sourceId);
  });

  it("v28 clean save migrates through both steps and passes schema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV28Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const parsed = gameStateSchema.safeParse(loaded.value.state);
    expect(parsed.success).toBe(true);
    expect(loaded.value.state.settledQuarterlyPeriods).toEqual([]);
  });
});
