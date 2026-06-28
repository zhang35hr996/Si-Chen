/**
 * Phase 5B-1B：宫斗调查案件存档持久化测试。
 * 验证：立案 → createSaveData → readSlot 后案件与报告链接完整保留。
 *
 * 注：readSlot 触发全量 schema 验证（含 scheme/incident/report 交叉引用），
 * 因此测试使用 buildIntrigueConsequences 构建精确匹配的 scheme outcome。
 */
import { describe, expect, it } from "vitest";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { buildIntrigueConsequences } from "../../src/engine/characters/haremIntrigue/consequences";
import { makeGameTime } from "../../src/engine/calendar/time";
import type {
  GameState,
  HaremScheme,
  HaremIncident,
  HaremIntrigueReport,
} from "../../src/engine/state/types";
import type { HaremIntriguePlan } from "../../src/engine/characters/haremIntrigue/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);
const AT = makeGameTime(1, 3, "early");

const ACTOR_ID = "cheng_feng";   // real DB character
const TARGET_ID = "lu_huaijin";   // real DB character

const actorSnapshot: HaremIntriguePlan["actorSnapshot"] = {
  characterId: ACTOR_ID, rankId: "meiren", rankOrder: 100,
  favor: 30, peakFavor: 50, affection: 50, fear: 40, ambition: 70, loyalty: 30,
  personality: { scheming: 70, sociability: 40, compassion: 20, courage: 60, jealousy: 70, emotionalStability: 30, pride: 40, intelligence: 55 },
  household: { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 30 },
};
const targetSnapshot: HaremIntriguePlan["targetSnapshot"] = {
  characterId: TARGET_ID, rankId: "guiren", rankOrder: 116,
  favor: 60, peakFavor: 70, affection: 50, fear: 30, ambition: 40, loyalty: 60,
  personality: { scheming: 30, sociability: 60, compassion: 60, courage: 40, jealousy: 30, emotionalStability: 60, pride: 50, intelligence: 50 },
  household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 20 },
};

const PLAN: HaremIntriguePlan = {
  sourceKey: "harem_intrigue:1:03", plannedAt: AT,
  year: 1, month: 3, actorId: ACTOR_ID, targetId: TARGET_ID,
  kind: "slander", motive: "jealousy",
  actorPropensity: 70, targetThreat: 60, priority: 65,
  potency: 55, secrecy: 50, grievanceStrength: 0, factionConflict: false,
  actorSnapshot, targetSnapshot,
  rationale: ["high_jealousy", "favor_gap"],
};

const SCHEME_ID = `scheme_1_03_${ACTOR_ID}_${TARGET_ID}`;
const INCIDENT_ID = `incident_${SCHEME_ID}`;
const REPORT_ID = `ireport_${INCIDENT_ID}`;

/** Build a fully-validated state: scheme(resolved) → incident → report.
 *  Uses buildIntrigueConsequences to ensure outcome.consequences passes schema validation. */
function makeValidatedState(): GameState {
  const success = true;
  const discovered = true;
  const consequences = buildIntrigueConsequences(PLAN, success, discovered);

  const scheme: HaremScheme = {
    id: SCHEME_ID,
    sourceKey: PLAN.sourceKey,
    plan: PLAN,
    status: "resolved",
    scheduledForYear: 1,
    scheduledForMonth: 3,
    outcome: {
      status: "resolved",
      resolvedAt: AT,
      successRoll: 30, successThreshold: 60,
      success, discovered,
      discoveryRoll: 20, discoveryThreshold: 50,
      consequences,
      knowledge: {
        actorKnowsOwnAction: true,
        targetKnowsInstigator: discovered,
        palacePublic: discovered,
      },
    },
  };

  const incident: HaremIncident = {
    id: INCIDENT_ID,
    schemeId: SCHEME_ID,
    actorId: ACTOR_ID,
    targetId: TARGET_ID,
    kind: "slander",
    success,
    observationLevel: "exposed",
    resolvedAt: AT,
    consequencesApplied: true,
    // exposed 需要 courtEventId（validator 检查）—— 用任意非空串
    courtEventId: "court_persist_001",
  };

  const report: HaremIntrigueReport = {
    id: REPORT_ID,
    source: { incidentId: INCIDENT_ID },
    reportKind: "exposure",
    createdAt: AT,
    status: "unread",
    knownTargetIds: [TARGET_ID],
    suspectedActorIds: [ACTOR_ID],
    suspectedKinds: ["slander"],
    knownOutcome: "harm_observed",
    confidence: "confirmed",
    summaryCode: "exposure_slander_success",
  };

  return {
    ...base,
    haremSchemes: [scheme],
    haremIncidents: [incident],
    haremIntrigueReports: [report],
    settledHaremIntriguePeriods: ["harem_intrigue_settlement:1:03"],
  };
}

describe("haremInvestigation: save round-trip", () => {
  it("openHaremInvestigation → createSaveData → readSlot：案件完整保留", () => {
    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(makeValidatedState());

    const r = store.openHaremInvestigation(REPORT_ID);
    if (!r.ok) console.error("openHaremInvestigation failed:", JSON.stringify(r.error));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const caseId = r.value.caseId;

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));

    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const restoredCase = loaded.value.state.haremInvestigationCases.find((c) => c.id === caseId);
    expect(restoredCase).toBeDefined();
    // confidence=confirmed → case opens as ready_for_review (H1 fix)
    expect(restoredCase?.status).toBe("ready_for_review");
    expect(restoredCase?.knownTargetIds).toEqual([TARGET_ID]);
    expect(restoredCase?.source.reportId).toBe(REPORT_ID);
    expect(restoredCase?.openedFromReportKind).toBe("exposure");

    const restoredReport = loaded.value.state.haremIntrigueReports.find((rp) => rp.id === REPORT_ID);
    expect(restoredReport?.linkedInvestigationId).toBe(caseId);
    expect(restoredReport?.status).toBe("actioned");
    expect(restoredReport?.action).toBe("investigating");
  });

  it("立案后 report 不再属于 unread（不会触发中断）", () => {
    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(makeValidatedState());
    store.openHaremInvestigation(REPORT_ID);

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const unread = loaded.value.state.haremIntrigueReports.filter((rp) => rp.status === "unread");
    expect(unread).toHaveLength(0);
  });

  it("anomaly 报告立案 → createSaveData → readSlot：无嫌疑人知识边界完整保留", () => {
    // observationLevel="anomaly" 不需要 courtEventId（只有 exposed 需要）
    const anomalySuccess = false;
    const anomalyDiscovered = false;
    const anomalyConsequences = buildIntrigueConsequences(PLAN, anomalySuccess, anomalyDiscovered);

    const anomalySchemeId = `scheme_anomaly_1_03`;
    const anomalyIncidentId = `incident_${anomalySchemeId}`;
    const anomalyReportId = `ireport_${anomalyIncidentId}`;

    const anomalyScheme: HaremScheme = {
      id: anomalySchemeId,
      sourceKey: "harem_intrigue:1:03",
      plan: PLAN,
      status: "resolved",
      scheduledForYear: 1,
      scheduledForMonth: 3,
      outcome: {
        status: "resolved",
        resolvedAt: AT,
        successRoll: 70, successThreshold: 60,
        success: anomalySuccess, discovered: anomalyDiscovered,
        discoveryRoll: 80, discoveryThreshold: 50,
        consequences: anomalyConsequences,
        knowledge: {
          actorKnowsOwnAction: true,
          targetKnowsInstigator: false,
          palacePublic: false,
        },
      },
    };

    const anomalyIncident: HaremIncident = {
      id: anomalyIncidentId,
      schemeId: anomalySchemeId,
      actorId: ACTOR_ID,
      targetId: TARGET_ID,
      kind: "slander",
      success: anomalySuccess,
      observationLevel: "anomaly",
      resolvedAt: AT,
      consequencesApplied: true,
    };

    const anomalyReport: HaremIntrigueReport = {
      id: anomalyReportId,
      source: { incidentId: anomalyIncidentId },
      reportKind: "anomaly",
      createdAt: AT,
      status: "unread",
      knownTargetIds: [TARGET_ID],
      suspectedActorIds: [],
      suspectedKinds: [],
      knownOutcome: "harm_observed",
      confidence: "tenuous",
      summaryCode: "anomaly_unexplained_harm",
    };

    const anomalyState: GameState = {
      ...base,
      haremSchemes: [anomalyScheme],
      haremIncidents: [anomalyIncident],
      haremIntrigueReports: [anomalyReport],
      settledHaremIntriguePeriods: ["harem_intrigue_settlement:1:03"],
    };

    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(anomalyState);

    const r = store.openHaremInvestigation(anomalyReportId);
    if (!r.ok) console.error("anomaly openHaremInvestigation failed:", JSON.stringify(r.error));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("anomaly readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const restoredCase = loaded.value.state.haremInvestigationCases.find((c) => c.id === r.value.caseId);
    expect(restoredCase).toBeDefined();
    expect(restoredCase?.suspectIds).toEqual([]);
    expect(restoredCase?.suspectedKinds).toEqual([]);
    expect(restoredCase?.openedFromReportKind).toBe("anomaly");

    // 双向链接完整
    const restoredReport = loaded.value.state.haremIntrigueReports.find((rp) => rp.id === anomalyReportId);
    expect(restoredReport?.linkedInvestigationId).toBe(r.value.caseId);
    expect(restoredCase?.source.reportId).toBe(anomalyReportId);
  });
});
