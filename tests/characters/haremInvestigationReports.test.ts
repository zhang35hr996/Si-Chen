/**
 * Phase 5B-3：调查结算自动生成通报 + report presenter 分路测试。
 */
import { describe, expect, it } from "vitest";
import { settleDueInvestigationTasks, nextTaskId } from "../../src/engine/characters/haremInvestigation/settlement";
import { createIntrigueInvestigationCase, cancelIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";
import { createInitialState } from "../../src/engine/state/initialState";
import { presentHaremIntrigueReport, intrigueReportSummaryLine } from "../../src/ui/haremIntrigueReportPresenter";
import type { GameState, HaremIntrigueReport } from "../../src/engine/state/types";
import { makeGameTime, fromTurnIndex } from "../../src/engine/calendar/time";
import { validateHaremInvestigationLinks } from "../../src/engine/characters/haremInvestigation/stateValidation";
import { buildIntrigueConsequences } from "../../src/engine/characters/haremIntrigue/consequences";
import { createGameStore } from "../../src/store/gameStore";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { HaremScheme, HaremIncident } from "../../src/engine/state/types";
import type { HaremIntriguePlan } from "../../src/engine/characters/haremIntrigue/types";
import { loadRealContent } from "../helpers/contentFixture";

const AT = makeGameTime(1, 3, "early");

const BASE_REPORT: HaremIntrigueReport = {
  id: "ireport_settle_rpt_001",
  source: { incidentId: "incident_rpt_001" },
  reportKind: "rumor",
  createdAt: AT,
  status: "unread",
  knownTargetIds: ["target_rpt"],
  suspectedActorIds: ["suspect_rpt"],
  suspectedKinds: ["slander"],
  knownOutcome: "harm_observed",
  confidence: "tenuous",
  summaryCode: "rumor_heard",
};

function makeStateWithCase(): GameState {
  const base = createInitialState();
  const s: GameState = {
    ...base,
    haremIntrigueReports: [BASE_REPORT],
    standing: {
      target_rpt: { lifecycle: "active" } as unknown as GameState["standing"][string],
      suspect_rpt: { lifecycle: "active" } as unknown as GameState["standing"][string],
    },
  };
  const r = createIntrigueInvestigationCase(s, "ireport_settle_rpt_001", AT);
  if (!r.ok) throw new Error("setup failed: " + JSON.stringify(r.error));
  return r.value.state;
}

// ── 报告生成 ───────────────────────────────────────────────────────────

describe("settleDueInvestigationTasks: 生成调查通报", () => {
  it("到期任务结算后生成 investigation_update 报告", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    const reports = result.state.haremIntrigueReports;
    const invReport = reports.find((r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final");
    expect(invReport).toBeDefined();
    expect(invReport?.linkedInvestigationId).toBe(caseId);
    expect(invReport?.status).toBe("unread");
  });

  it("confidence=confirmed → 案件必进 ready_for_review → 报告必为 investigation_final", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    // confirmed 置信度 + in_progress → applyInvestigationLead 必然升为 ready_for_review
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const, confidence: "confirmed" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    const settledCase = result.state.haremInvestigationCases.find((c) => c.id === caseId);
    expect(settledCase?.status).toBe("ready_for_review");
    const finalReport = result.state.haremIntrigueReports.find((r) => r.reportKind === "investigation_final");
    expect(finalReport).toBeDefined();
    const updateReport = result.state.haremIntrigueReports.find((r) => r.reportKind === "investigation_update");
    expect(updateReport).toBeUndefined();
  });

  it("幂等：catch-up 不重复生成同一 task 的报告", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const r1 = settleDueInvestigationTasks({} as never, withTask, AT);
    // Re-run on already-settled state
    const r2 = settleDueInvestigationTasks({} as never, r1.state, AT);
    const invReports = r2.state.haremIntrigueReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReports.length).toBe(1);
  });

  it("取消案件后 pending task 不生成报告", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const cancelResult = cancelIntrigueInvestigationCase(s, caseId, AT);
    if (!cancelResult.ok) throw new Error("cancel failed");
    const taskId = nextTaskId(1);
    const withStaleTask: GameState = {
      ...cancelResult.value,
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withStaleTask, AT);
    const invReports = result.state.haremIntrigueReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReports.length).toBe(0);
  });

  it("报告 linkedInvestigationId 正确", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    const invReport = result.state.haremIntrigueReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReport?.linkedInvestigationId).toBe(caseId);
  });

  it("报告不含后台 actorId（suspectedActorIds 来自 case.suspectIds）", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    const invReport = result.state.haremIntrigueReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    // suspectedActorIds should only contain case.suspectIds, never raw backend actorId
    const knownSuspects = new Set(s.haremInvestigationCases[0]!.suspectIds);
    for (const id of invReport?.suspectedActorIds ?? []) {
      expect(knownSuspects.has(id)).toBe(true);
    }
  });
});

// ── Presenter ─────────────────────────────────────────────────────────

const RESOLVE_NAME = (id: string) => `name_${id}`;

function makeInvestigationReport(kind: HaremIntrigueReport["reportKind"]): HaremIntrigueReport {
  return {
    id: "ireport_inv_test",
    source: { incidentId: "incident_inv_test" },
    reportKind: kind,
    createdAt: AT,
    status: "unread",
    knownTargetIds: ["target_a"],
    suspectedActorIds: ["suspect_x"],
    suspectedKinds: ["slander"],
    knownOutcome: "unknown",
    confidence: "plausible",
    summaryCode: "inquiry_limited_findings",
    linkedInvestigationId: "icase_test",
  };
}

describe("presentHaremIntrigueReport — investigation_update", () => {
  it("title = 调查已有进展", () => {
    const pres = presentHaremIntrigueReport(makeInvestigationReport("investigation_update"), RESOLVE_NAME);
    expect(pres.title).toBe("调查已有进展");
  });

  it("body 有内容（非 anomaly fallback）", () => {
    const pres = presentHaremIntrigueReport(makeInvestigationReport("investigation_update"), RESOLVE_NAME);
    expect(pres.body.join("")).not.toContain("宫中近日似有异常");
    expect(pres.body.length).toBeGreaterThan(0);
  });

  it("不包含 actorLabel", () => {
    const pres = presentHaremIntrigueReport(makeInvestigationReport("investigation_update"), RESOLVE_NAME);
    expect(pres.actorLabel).toBeUndefined();
  });

  it("intrigueReportSummaryLine 含 '调查'", () => {
    const line = intrigueReportSummaryLine(makeInvestigationReport("investigation_update"), RESOLVE_NAME);
    expect(line).toContain("调查");
  });
});

describe("presentHaremIntrigueReport — investigation_final", () => {
  it("title = 调查结果上报", () => {
    const pres = presentHaremIntrigueReport(makeInvestigationReport("investigation_final"), RESOLVE_NAME);
    expect(pres.title).toBe("调查结果上报");
  });

  it("body 不含 anomaly 文案", () => {
    const pres = presentHaremIntrigueReport(makeInvestigationReport("investigation_final"), RESOLVE_NAME);
    expect(pres.body.join("")).not.toContain("宫中近日似有异常");
    expect(pres.body.join("")).toContain("待圣上裁定");
  });

  it("intrigueReportSummaryLine 含 '待裁定'", () => {
    const line = intrigueReportSummaryLine(makeInvestigationReport("investigation_final"), RESOLVE_NAME);
    expect(line).toContain("待裁定");
  });
});

describe("presentHaremIntrigueReport — unknown summaryCode fallback", () => {
  it("update 未知 summaryCode 有 fallback，不报错", () => {
    const r = { ...makeInvestigationReport("investigation_update"), summaryCode: "totally_unknown_code" };
    const pres = presentHaremIntrigueReport(r, RESOLVE_NAME);
    expect(pres.body.length).toBeGreaterThan(0);
  });

  it("final 未知 summaryCode 有 fallback", () => {
    const r = { ...makeInvestigationReport("investigation_final"), summaryCode: "totally_unknown_code" };
    const pres = presentHaremIntrigueReport(r, RESOLVE_NAME);
    expect(pres.body.join("")).toContain("待圣上裁定");
  });
});

// ── overdue tasks — not yet due guard ────────────────────────────────

describe("settleDueInvestigationTasks — not yet due", () => {
  it("未到期任务不生成报告", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const futureDue = fromTurnIndex(AT.dayIndex + 10);
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: futureDue, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    const invReports = result.state.haremIntrigueReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReports.length).toBe(0);
  });
});

// ── ready_for_review → investigation_final（确定性路径）────────────────


// ── source field fix (B1A) + validator differentiation (B1B) ──────────

describe("investigation_update/final report — source 字段与 validator 分路", () => {
  it("B1A: 生成报告的 source 只含 incidentId，不含多余的 reportId", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const settled = settleDueInvestigationTasks({} as never, withTask, AT).state;
    const invReport = settled.haremIntrigueReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReport).toBeDefined();
    // source must have ONLY incidentId — no reportId field
    expect(Object.keys(invReport!.source)).toEqual(["incidentId"]);
    expect("reportId" in invReport!.source).toBe(false);
    expect(invReport!.source.incidentId).toBeDefined();
  });

  it("B1B: validator 对 investigation_update/final 不要求 actioned/investigating", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const settled = settleDueInvestigationTasks({} as never, withTask, AT).state;
    // Verify investigation report is present and unread (not actioned)
    const invReport = settled.haremIntrigueReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReport).toBeDefined();
    expect(invReport!.status).toBe("unread");
    // The investigation-domain validator should not flag the report as broken
    const errors = validateHaremInvestigationLinks({
      ...settled,
      incidentIds: new Set(settled.haremIncidents.map((i) => i.id)),
    });
    const reportErrors = errors.filter((e: { message: string }) => e.message.includes(invReport!.id));
    expect(reportErrors).toHaveLength(0);
  });

  it("B1B+round-trip: 调查通报通过全量 schema 校验并正常 readSlot", () => {
    // 复用 haremInvestigationPersistence.test.ts 的完整 fixture 模式：
    // resolved scheme → incident → source report → openHaremInvestigation → pending task
    // → settleDueInvestigationTasks → investigation_update → createSaveData → readSlot
    const db = loadRealContent();
    const base = createNewGameState(db, 1);

    const ACTOR_ID = "cheng_feng";
    const TARGET_ID = "lu_huaijin";
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
    const plan: HaremIntriguePlan = {
      sourceKey: "harem_intrigue:1:03", plannedAt: AT,
      year: 1, month: 3, actorId: ACTOR_ID, targetId: TARGET_ID,
      kind: "slander", motive: "jealousy",
      actorPropensity: 70, targetThreat: 60, priority: 65,
      potency: 55, secrecy: 50, grievanceStrength: 0, factionConflict: false,
      actorSnapshot, targetSnapshot,
      rationale: ["high_jealousy", "favor_gap"],
    };
    const consequences = buildIntrigueConsequences(plan, true, false);
    const schemeId = `scheme_rt_b1b_${ACTOR_ID}_${TARGET_ID}`;
    const incidentId = `incident_${schemeId}`;
    const reportId = `ireport_${incidentId}`;

    const scheme: HaremScheme = {
      id: schemeId, sourceKey: plan.sourceKey, plan,
      status: "resolved", scheduledForYear: 1, scheduledForMonth: 3,
      outcome: {
        status: "resolved", resolvedAt: AT,
        successRoll: 30, successThreshold: 60, success: true,
        discovered: false, discoveryRoll: 80, discoveryThreshold: 50,
        consequences,
        knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
      },
    };
    const incident: HaremIncident = {
      id: incidentId, schemeId, actorId: ACTOR_ID, targetId: TARGET_ID,
      kind: "slander", success: true, observationLevel: "anomaly",
      resolvedAt: AT, consequencesApplied: true,
    };
    const sourceReport: HaremIntrigueReport = {
      id: reportId, source: { incidentId },
      reportKind: "anomaly", createdAt: AT, status: "unread",
      knownTargetIds: [TARGET_ID], suspectedActorIds: [],
      suspectedKinds: [], knownOutcome: "unknown",
      confidence: "tenuous", summaryCode: "anomaly_unexplained_harm",
    };

    const store = createGameStore();
    store.loadState({
      ...base,
      haremSchemes: [scheme],
      haremIncidents: [incident],
      haremIntrigueReports: [...base.haremIntrigueReports, sourceReport],
      settledHaremIntriguePeriods: ["harem_intrigue_settlement:1:03"],
    });

    const openResult = store.openHaremInvestigation(reportId);
    expect(openResult.ok).toBe(true);
    if (!openResult.ok) throw new Error("openHaremInvestigation failed: " + JSON.stringify(openResult.error));
    const caseId = openResult.value.caseId;

    // Add a pending task due now
    const taskId = nextTaskId(store.getState().haremInvestigationNextSeq);
    const stateWithTask: GameState = {
      ...store.getState(),
      haremInvestigationCases: store.getState().haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        ...store.getState().haremInvestigationTasks,
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const settled = settleDueInvestigationTasks({} as never, stateWithTask, AT).state;

    // Investigation report must be present
    const invReport = settled.haremIntrigueReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(invReport).toBeDefined();
    // source must only have incidentId (B1A)
    expect(Object.keys(invReport!.source)).toEqual(["incidentId"]);

    // Full round-trip
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, settled, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("readSlot failed: " + JSON.stringify(loaded.error));

    const roundTripped = loaded.value.state.haremIntrigueReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(roundTripped).toBeDefined();
    expect(roundTripped!.linkedInvestigationId).toBe(caseId);
    expect(roundTripped!.source.incidentId).toBe(incidentId);
  });
});
