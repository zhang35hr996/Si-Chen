/**
 * Save format v38 → v39 migration tests.
 *
 * v39 = 证据评估与自然结案（Phase 5B-2B2b）：
 *   新增 closed_explained 案件状态、closureReason="cause_confirmed"、confirmedCause 字段。
 *   旧档不含这些字段，迁移仅前移版本号；新引擎写出的 closed_explained 状态旧引擎无法识别，
 *   故必须升档以阻止旧引擎误读。
 */
import { describe, expect, it } from "vitest";
import {
  SAVE_FORMAT_VERSION,
  MIGRATIONS,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";
import type { IntrigueInvestigationLead } from "../../src/engine/characters/haremInvestigation/types";

const db = loadRealContent();
const AT = makeGameTime(1, 1, "early");

it("V39-01: SAVE_FORMAT_VERSION >= 39", () => {
  expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(39);
});

/** Build a clean v38-format save envelope. */
function makeV38Envelope(stateOverrides: Record<string, unknown> = {}) {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  Object.assign(raw, stateOverrides);
  const current = createSaveData(db, s, "slot1");
  return {
    ...current,
    formatVersion: 38,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
}

describe("save migration v38 → v39", () => {
  it("V39-02: 干净 v38 存档迁移后通过 schema 且版本前进到 39", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(makeV38Envelope()));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
  });

  it("V39-03: 迁移函数前移版本号并重算 checksum，不改动 state 形状", () => {
    const env = makeV38Envelope();
    const migrated = MIGRATIONS[38]!(env) as { formatVersion: number; state: unknown; checksum: string };
    expect(migrated.formatVersion).toBe(39);
    expect(migrated.checksum).toBe(checksumOf(env.state as unknown as GameState));
    // state 形状不变（v39 字段仅在新建 closed_explained 案件时出现）
    expect((migrated.state as Record<string, unknown>)["haremInvestigationCases"]).toEqual(
      (env.state as Record<string, unknown>)["haremInvestigationCases"],
    );
  });

  it("V39-04: round-trip — closed_explained 案件（confirmedCause=negligence）存活并通过校验", () => {
    // 用真实流程建出合法 incident+truth+report+case，再注入受控 negligence 真相与线索
    const store = createGameStore();
    const base = createNewGameState(db);
    const standing = Object.fromEntries(
      Object.entries(base.standing).map(([id, st]) => [id, { ...st, household: st.household ?? { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 40 } }]),
    );
    store.loadState({ ...base, standing } as GameState);
    const made = store.createHeirHealthAnomaly({ victimHeirId: "heir_001", accuserIds: [], initiallyAccusedIds: [], symptom: "hysteria", publicFactCodes: ["heir_fell_ill"], victimHealth: 60 });
    if (!made.ok) throw new Error("create anomaly failed");
    const opened = store.openInvestigationFromAnomalyReport(made.value.reportId);
    if (!opened.ok) throw new Error("open case failed");
    const caseId = opened.value.caseId;

    const s = store.getState();
    const incidentSourceKey = s.investigationIncidents.find((i) => i.id === made.value.incidentId)!.sourceKey;
    const truth = {
      id: made.value.truthId, incidentId: made.value.incidentId, eventFamily: "heir_health_anomaly" as const,
      causeType: "negligence" as const, culpritIds: [], accusedIds: [], framingTargetIds: [],
      method: "wrong_dosage" as const, motive: "none" as const, concealment: 0,
      evidenceNodes: [
        { id: "rn1", type: "medical" as const, factCode: "dosage_mismatch_prescription", claims: [{ kind: "supports_cause" as const, causeType: "negligence" as const }], difficulty: 10, decayPerPeriod: 0, discoverableBy: ["medical_examination" as const], prerequisiteEvidenceIds: [] as string[], misleading: false },
        { id: "rn2", type: "physical" as const, factCode: "missing_decoction_record", claims: [{ kind: "supports_cause" as const, causeType: "negligence" as const }], difficulty: 10, decayPerPeriod: 0, discoverableBy: ["search_quarters" as const], prerequisiteEvidenceIds: [] as string[], misleading: false },
      ],
      generatedAt: AT, sourceKey: incidentSourceKey,
    };
    const leads: Record<string, IntrigueInvestigationLead> = {
      ilead_000001: { id: "ilead_000001", caseId, discoveredAt: AT, method: "medical_examination", summaryCode: "evidence_dosage_mismatch_prescription", strength: "plausible", implicatedIds: [], clearedIds: [], revealedKinds: [], sourceEvidenceNodeId: "rn1", claims: [{ kind: "supports_cause", causeType: "negligence" }] },
      ilead_000002: { id: "ilead_000002", caseId, discoveredAt: AT, method: "search_quarters", summaryCode: "evidence_missing_decoction_record", strength: "plausible", implicatedIds: [], clearedIds: [], revealedKinds: [], sourceEvidenceNodeId: "rn2", claims: [{ kind: "supports_cause", causeType: "negligence" }] },
    };
    const cases = s.haremInvestigationCases.map((c) => c.id === caseId ? { ...c, status: "ready_for_review" as const, confidence: "confirmed" as const, leadIds: ["ilead_000001", "ilead_000002"] } : c);
    store.loadState({ ...s, investigationTruths: [truth], haremInvestigationLeads: leads, haremInvestigationCases: cases, haremInvestigationNextSeq: 3 } as GameState);

    const r = store.reviewHaremInvestigation(caseId, { type: "confirm_cause", causeType: "negligence" });
    expect(r.ok).toBe(true);

    const storage = createMemoryStorage();
    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const c = loaded.value.state.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("closed_explained");
    expect(c.confirmedCause).toBe("negligence");
    expect(c.closureReason).toBe("cause_confirmed");
  });
});
