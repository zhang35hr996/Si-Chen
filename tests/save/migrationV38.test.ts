/**
 * Save format v37 → v38 migration tests.
 *
 * v38 = 隐藏真相与调查执行层接轨（Phase 5B-2B1）：
 *   新增 investigationPublicReports: []；
 *   存量 haremInvestigationCases[].source 补判别字段 kind="legacy_intrigue"。
 */
import { describe, expect, it } from "vitest";
import {
  SAVE_FORMAT_VERSION,
  MIGRATIONS,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

it("V38-01: SAVE_FORMAT_VERSION >= 38", () => {
  expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(38);
});

/** Build a clean v37-format save envelope (no investigationPublicReports field). */
function makeV37Envelope(stateOverrides: Record<string, unknown> = {}) {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["investigationPublicReports"];
  Object.assign(raw, stateOverrides);
  const current = createSaveData(db, s, "slot1");
  return {
    ...current,
    formatVersion: 37,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
}

describe("save migration v37 → v38", () => {
  it("V38-02: 干净 v37 存档迁移后 investigationPublicReports=[] 且通过 schema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(makeV37Envelope()));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.investigationPublicReports).toEqual([]);
  });

  it("V38-03: 迁移函数为存量 case.source 补齐 kind=legacy_intrigue", () => {
    const env = makeV37Envelope({
      haremInvestigationCases: [
        {
          id: "icase_x",
          source: { reportId: "rep_x", incidentId: "inc_x" },
          openedAt: { year: 1, month: 1, phase: "early" },
          openedFromReportKind: "exposure",
          status: "cancelled",
          knownTargetIds: ["heir_001"],
          suspectIds: [],
          suspectedKinds: [],
          confidence: "tenuous",
          leadIds: [],
          closedAt: { year: 1, month: 1, phase: "early" },
          closureReason: "player_cancelled",
        },
      ],
    });
    // 直接驱动迁移函数（避开 schema cross-link：report/incident 故意缺失）
    const migrated = MIGRATIONS[37]!(env) as { formatVersion: number; state: unknown };
    const cases = (migrated.state as Record<string, unknown>)["haremInvestigationCases"] as Record<string, unknown>[];
    const source = cases[0]!["source"] as Record<string, unknown>;
    expect(source["kind"]).toBe("legacy_intrigue");
    expect(source["reportId"]).toBe("rep_x");
    expect(source["incidentId"]).toBe("inc_x");
    expect((migrated.state as Record<string, unknown>)["investigationPublicReports"]).toEqual([]);
    expect(migrated.formatVersion).toBe(38);
  });

  it("V38-04: 已有 kind 的 case.source 不被覆盖", () => {
    const env = makeV37Envelope({
      haremInvestigationCases: [
        {
          id: "icase_y",
          source: { kind: "investigation_incident", reportId: "iarep_y", incidentId: "inc_y" },
          openedAt: { year: 1, month: 1, phase: "early" },
          openedFromReportKind: "anomaly",
          status: "cancelled",
          knownTargetIds: ["heir_001"],
          suspectIds: [],
          suspectedKinds: [],
          confidence: "tenuous",
          leadIds: [],
          closedAt: { year: 1, month: 1, phase: "early" },
          closureReason: "player_cancelled",
        },
      ],
    });
    const migrated = MIGRATIONS[37]!(env) as { formatVersion: number; state: unknown };
    const cases = (migrated.state as Record<string, unknown>)["haremInvestigationCases"] as Record<string, unknown>[];
    const source = cases[0]!["source"] as Record<string, unknown>;
    expect(source["kind"]).toBe("investigation_incident");
  });

  it("V38-05: round-trip createSaveData → readSlot 保留 investigationPublicReports", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.investigationPublicReports).toEqual([]);
  });
});
