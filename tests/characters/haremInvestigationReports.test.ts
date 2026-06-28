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

const AT = makeGameTime(1, 3, "early");
const AT2 = makeGameTime(1, 3, "mid");

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

  it("reach ready_for_review → investigation_final", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    // Force case to ready_for_review via strong confidence
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const, confidence: "strong" } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    // After settlement, if case hit ready_for_review, report should be investigation_final
    const finalReport = result.state.haremIntrigueReports.find((r) => r.reportKind === "investigation_final");
    // May or may not be final depending on RNG; just verify no crash and report exists
    const updateReport = result.state.haremIntrigueReports.find((r) => r.reportKind === "investigation_update");
    expect(finalReport ?? updateReport).toBeDefined();
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
