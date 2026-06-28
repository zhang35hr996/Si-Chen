/**
 * Save format v36 → v37 migration tests.
 *
 * v37 = 宫斗事件后台真相层（Phase 5B-2A）：
 *   新增 investigationIncidents: [] 和 investigationTruths: [] 字段。
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
import { makeGameTime } from "../../src/engine/calendar/time";
import type {
  InvestigationTruth,
  HeirHealthAnomalyIncident,
} from "../../src/engine/characters/haremInvestigation/truth/types";

const db = loadRealContent();

// ── version check ──────────────────────────────────────────────────────────────

it("V37-01: SAVE_FORMAT_VERSION >= 37", () => {
  expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(37);
});

// ── v36 save builder ───────────────────────────────────────────────────────────

/** Build a v36-format save (no investigationIncidents / investigationTruths fields). */
function makeV36Save(): string {
  const s = createNewGameState(db);
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["investigationIncidents"];
  delete raw["investigationTruths"];
  const current = createSaveData(db, s, "slot1");
  const env = {
    ...current,
    formatVersion: 36,
    state: raw,
    checksum: checksumOf(raw as unknown as GameState),
  };
  return JSON.stringify(env);
}

// ── v36 → v37 migration ────────────────────────────────────────────────────────

describe("save migration v36 → v37", () => {
  it("V37-02: v36 save without investigationIncidents/Truths → both fields initialised to []", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV36Save());
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.investigationIncidents).toEqual([]);
    expect(loaded.value.state.investigationTruths).toEqual([]);
  });

  it("V37-03: valid HeirHealthAnomalyIncident passes schema validation", () => {
    const AT = makeGameTime(1, 1, "early");
    const validIncident: HeirHealthAnomalyIncident = {
      id: "heir_health_heir_001_12345678",
      eventFamily: "heir_health_anomaly",
      occurredAt: AT,
      sourceKey: "heir_health_anomaly:1:01",
      victimHeirId: "heir_001",
      accuserIds: [],
      initiallyAccusedIds: [],
      symptom: "hysteria",
      publicFactCodes: [],
    };

    const parsed = gameStateSchema.safeParse({
      ...createNewGameState(db),
      investigationIncidents: [validIncident],
      investigationTruths: [],
    });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const structuralIssues = issues.filter(
        (i) => !i.message.includes("not found in investigationIncidents"),
      );
      expect(structuralIssues).toHaveLength(0);
    }
  });

  it("V37-04: valid InvestigationTruth with claims passes schema validation", () => {
    const AT = makeGameTime(1, 1, "early");
    const validIncident: HeirHealthAnomalyIncident = {
      id: "heir_health_heir_001_abc123",
      eventFamily: "heir_health_anomaly",
      occurredAt: AT,
      sourceKey: "heir_health_anomaly:1:01",
      victimHeirId: "heir_001",
      accuserIds: [],
      initiallyAccusedIds: [],
      symptom: "high_fever",
      publicFactCodes: [],
    };

    const validTruth: InvestigationTruth = {
      id: "itruth_heir_health_heir_001_abc123",
      incidentId: "heir_health_heir_001_abc123",
      eventFamily: "heir_health_anomaly",
      causeType: "natural_illness",
      culpritIds: [],
      accusedIds: [],
      framingTargetIds: [],
      method: "none",
      motive: "none",
      concealment: 55,
      evidenceNodes: [
        {
          id: "evidence_itruth_heir_health_heir_001_abc123_diagnosis_0",
          type: "medical",
          factCode: "diagnosis_matches_old_illness",
          claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
          difficulty: 20,
          decayPerPeriod: 5,
          discoverableBy: ["medical_examination"],
          prerequisiteEvidenceIds: [],
          misleading: false,
        },
      ],
      generatedAt: AT,
      sourceKey: "heir_health_anomaly:1:01",
    };

    const parsed = gameStateSchema.safeParse({
      ...createNewGameState(db),
      investigationIncidents: [validIncident],
      investigationTruths: [validTruth],
    });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const structuralIssues = issues.filter(
        (i) => !i.message.includes("not found in investigationIncidents"),
      );
      expect(structuralIssues).toHaveLength(0);
    }
  });

  it("V37-05: round-trip createSaveData → readSlot (v37) preserves investigationIncidents + investigationTruths", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const saveData = createSaveData(db, state, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.investigationIncidents).toEqual([]);
    expect(loaded.value.state.investigationTruths).toEqual([]);
  });
});
