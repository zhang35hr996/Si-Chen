/**
 * Phase 5B-1A：宫斗调查案件领域模型单元测试。
 * 测试：createIntrigueInvestigationCase, cancelIntrigueInvestigationCase,
 *        store actions, validation invariants.
 */
import { describe, expect, it } from "vitest";
import { createIntrigueInvestigationCase, cancelIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";
import { validateHaremInvestigationLinks } from "../../src/engine/characters/haremInvestigation/stateValidation";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, HaremIntrigueReport } from "../../src/engine/state/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);

const AT: GameTime = makeGameTime(1, 3, "early");

function makeReport(overrides: Partial<HaremIntrigueReport> = {}): HaremIntrigueReport {
  return {
    id: "ireport_test_001",
    source: { incidentId: "incident_001" },
    reportKind: "exposure",
    createdAt: AT,
    status: "unread",
    knownTargetIds: ["lu_huaijin"],
    suspectedActorIds: ["bai_zhuying"],
    suspectedKinds: ["slander"],
    knownOutcome: "harm_observed",
    confidence: "confirmed",
    summaryCode: "exposure_slander_success",
    ...overrides,
  };
}

function stateWithReport(report: HaremIntrigueReport = makeReport()): GameState {
  return { ...base, haremIntrigueReports: [report] };
}


// ── createIntrigueInvestigationCase ───────────────────────────────────────────

describe("createIntrigueInvestigationCase", () => {
  it("creates case from exposure report", () => {
    const result = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.caseId).toBe("icase_ireport_test_001");
    const c = result.value.state.haremInvestigationCases[0]!;
    expect(c.status).toBe("open");
    expect(c.openedFromReportKind).toBe("exposure");
    expect(c.knownTargetIds).toEqual(["lu_huaijin"]);
    expect(c.suspectIds).toEqual(["bai_zhuying"]);
    expect(c.suspectedKinds).toEqual(["slander"]);
    expect(c.confidence).toBe("confirmed");
    expect(c.leadIds).toEqual([]);
    expect(c.source.reportId).toBe("ireport_test_001");
    expect(c.source.incidentId).toBe("incident_001");
  });

  it("sets report to actioned/investigating with acknowledgedAt", () => {
    const result = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value.state.haremIntrigueReports[0]!;
    expect(report.status).toBe("actioned");
    expect(report.action).toBe("investigating");
    expect(report.acknowledgedAt).toBeDefined();
    expect(report.linkedInvestigationId).toBe("icase_ireport_test_001");
  });

  it("already-acknowledged report: acknowledgedAt is preserved", () => {
    const alreadyAcked: GameTime = makeGameTime(1, 2, "early");
    const report = makeReport({ status: "acknowledged", acknowledgedAt: alreadyAcked });
    const result = createIntrigueInvestigationCase(stateWithReport(report), "ireport_test_001", AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updatedReport = result.value.state.haremIntrigueReports[0]!;
    expect(updatedReport.acknowledgedAt?.year).toBe(alreadyAcked.year);
    expect(updatedReport.acknowledgedAt?.month).toBe(alreadyAcked.month);
  });

  it("returns error for missing report", () => {
    const result = createIntrigueInvestigationCase(stateWithReport(), "does_not_exist", AT);
    expect(result.ok).toBe(false);
  });

  it("returns error for archived report", () => {
    const result = createIntrigueInvestigationCase(
      stateWithReport(makeReport({ status: "archived", acknowledgedAt: AT })),
      "ireport_test_001",
      AT,
    );
    expect(result.ok).toBe(false);
  });

  it("returns error for investigation_update reportKind", () => {
    const result = createIntrigueInvestigationCase(
      stateWithReport(makeReport({ reportKind: "investigation_update" })),
      "ireport_test_001",
      AT,
    );
    expect(result.ok).toBe(false);
  });

  it("returns error for investigation_final reportKind", () => {
    const result = createIntrigueInvestigationCase(
      stateWithReport(makeReport({ reportKind: "investigation_final" })),
      "ireport_test_001",
      AT,
    );
    expect(result.ok).toBe(false);
  });

  it("is idempotent: same report → same caseId", () => {
    const r1 = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = createIntrigueInvestigationCase(r1.value.state, "ireport_test_001", AT);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.caseId).toBe("icase_ireport_test_001");
    expect(r2.value.state.haremInvestigationCases).toHaveLength(1);
  });

  it("anomaly report can also be investigated", () => {
    const report = makeReport({ reportKind: "anomaly", summaryCode: "anomaly_unexplained_harm", suspectedActorIds: [] });
    const result = createIntrigueInvestigationCase(stateWithReport(report), "ireport_test_001", AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.haremInvestigationCases[0]!.openedFromReportKind).toBe("anomaly");
  });

  it("validateHaremInvestigationLinks: well-formed case with real incidentId set → no errors", () => {
    // Verify the incidentId cross-ref check works when real incidentIds are provided
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const errors = validateHaremInvestigationLinks({
      haremIntrigueReports: r.value.state.haremIntrigueReports,
      haremInvestigationCases: r.value.state.haremInvestigationCases,
      haremInvestigationTasks: r.value.state.haremInvestigationTasks,
      haremInvestigationLeads: r.value.state.haremInvestigationLeads,
      incidentIds: new Set(["incident_001"]),
    });
    expect(errors).toEqual([]);
  });
});

// ── cancelIntrigueInvestigationCase ───────────────────────────────────────────

describe("cancelIntrigueInvestigationCase", () => {
  function stateWithCase() {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error("setup failed");
    return r.value.state;
  }

  it("cancels an open case", () => {
    const s = stateWithCase();
    const cancelTime = makeGameTime(1, 4, "early");
    const result = cancelIntrigueInvestigationCase(s, "icase_ireport_test_001", cancelTime);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.value.haremInvestigationCases[0]!;
    expect(c.status).toBe("cancelled");
    expect(c.closedAt).toBeDefined();
    expect(c.closureReason).toBe("player_cancelled");
  });

  it("returns error for non-existent case", () => {
    const s = stateWithCase();
    const result = cancelIntrigueInvestigationCase(s, "icase_does_not_exist", AT);
    expect(result.ok).toBe(false);
  });

  it("returns error for already-cancelled case", () => {
    const s = stateWithCase();
    const r1 = cancelIntrigueInvestigationCase(s, "icase_ireport_test_001", AT);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = cancelIntrigueInvestigationCase(r1.value, "icase_ireport_test_001", AT);
    expect(r2.ok).toBe(false);
  });
});

// ── Store actions ──────────────────────────────────────────────────────────────

describe("store actions: openHaremInvestigation / cancelHaremInvestigation", () => {
  it("openHaremInvestigation creates case and updates report", () => {
    const store = createGameStore();
    store.loadState(stateWithReport());
    const result = store.openHaremInvestigation("ireport_test_001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.caseId).toBe("icase_ireport_test_001");
    expect(store.getState().haremInvestigationCases).toHaveLength(1);
    expect(store.getState().haremIntrigueReports[0]!.status).toBe("actioned");
  });

  it("cancelHaremInvestigation cancels open case", () => {
    const store = createGameStore();
    store.loadState(stateWithReport());
    store.openHaremInvestigation("ireport_test_001");
    const result = store.cancelHaremInvestigation("icase_ireport_test_001");
    expect(result.ok).toBe(true);
    expect(store.getState().haremInvestigationCases[0]!.status).toBe("cancelled");
  });

  it("cancelHaremInvestigation returns error for unknown case", () => {
    const store = createGameStore();
    store.loadState(stateWithReport());
    const result = store.cancelHaremInvestigation("icase_does_not_exist");
    expect(result.ok).toBe(false);
  });
});

// ── Validation invariants ──────────────────────────────────────────────────────

describe("validateHaremInvestigationLinks", () => {
  const makeInput = (
    reports: HaremIntrigueReport[],
    cases: Parameters<typeof validateHaremInvestigationLinks>[0]["haremInvestigationCases"],
    incidentIds = new Set(["incident_001"]),
  ) => validateHaremInvestigationLinks({ haremIntrigueReports: reports, haremInvestigationCases: cases, haremInvestigationTasks: {}, haremInvestigationLeads: {}, incidentIds });

  it("empty arrays → no errors", () => {
    expect(makeInput([], [])).toEqual([]);
  });

  it("detects duplicate case id", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const c = r.value.state.haremInvestigationCases[0]!;
    const errors = makeInput(r.value.state.haremIntrigueReports, [c, c]);
    expect(errors.some((e) => e.code === "INTRIGUE_DUP_CASE")).toBe(true);
  });

  it("detects missing source.reportId", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const c = { ...r.value.state.haremInvestigationCases[0]!, source: { reportId: "ghost_report", incidentId: "incident_001" } };
    const errors = makeInput(r.value.state.haremIntrigueReports, [c]);
    expect(errors.some((e) => e.code === "INTRIGUE_CASE_ORPHAN_REPORT")).toBe(true);
  });

  it("detects active case with closedAt", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const c = { ...r.value.state.haremInvestigationCases[0]!, closedAt: AT };
    const errors = makeInput(r.value.state.haremIntrigueReports, [c]);
    expect(errors.some((e) => e.code === "INTRIGUE_CASE_LIFECYCLE")).toBe(true);
  });

  it("case→report link: case points to report but report has no linkedInvestigationId → error", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    // Strip the back-link from the report
    const reports = r.value.state.haremIntrigueReports.map((rep) => {
      const { linkedInvestigationId: _, ...rest } = rep;
      return rest as HaremIntrigueReport;
    });
    const errors = makeInput(reports, r.value.state.haremInvestigationCases);
    expect(errors.some((e) => e.code === "INTRIGUE_CASE_BROKEN_LINK")).toBe(true);
  });

  it("two cases pointing at the same report → second case detected as broken link", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const c1 = r.value.state.haremInvestigationCases[0]!;
    // c2 claims the same report but has a different id → report.linkedInvestigationId points to c1, not c2
    const c2 = { ...c1, id: "icase_ireport_test_001_dup" };
    const errors = makeInput(r.value.state.haremIntrigueReports, [c1, c2]);
    expect(errors.some((e) => e.code === "INTRIGUE_CASE_BROKEN_LINK")).toBe(true);
  });

  it("openedFromReportKind mismatch with report.reportKind → error", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const c = { ...r.value.state.haremInvestigationCases[0]!, openedFromReportKind: "anomaly" as const };
    const errors = makeInput(r.value.state.haremIntrigueReports, [c]);
    expect(errors.some((e) => e.code === "INTRIGUE_CASE_KIND_MISMATCH")).toBe(true);
  });

  it("well-formed open case → no errors", () => {
    const r = createIntrigueInvestigationCase(stateWithReport(), "ireport_test_001", AT);
    if (!r.ok) throw new Error();
    const errors = makeInput(
      r.value.state.haremIntrigueReports,
      r.value.state.haremInvestigationCases,
    );
    expect(errors).toEqual([]);
  });
});
