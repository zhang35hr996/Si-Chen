/**
 * Phase 5B-2B1: validateInvestigationPublicReports 单元测试。
 * 覆盖孤儿报告、字段一致性、生命周期不变量、反向链接。
 */
import { describe, expect, it } from "vitest";
import { validateInvestigationPublicReports } from "../../src/engine/characters/haremInvestigation/stateValidation";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { HeirHealthAnomalyIncident } from "../../src/engine/characters/haremInvestigation/truth/types";
import type { HeirHealthAnomalyPublicReport, InvestigationPublicReport, IntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/types";

const AT = makeGameTime(1, 1, "early");

const INCIDENT: HeirHealthAnomalyIncident = {
  id: "heir_health_heir_001_abc",
  eventFamily: "heir_health_anomaly",
  occurredAt: AT,
  sourceKey: "heir_health_anomaly:1:01:heir_001",
  victimHeirId: "heir_001",
  accuserIds: ["acc_1"],
  initiallyAccusedIds: ["sus_1"],
  symptom: "hysteria",
  publicFactCodes: ["heir_fell_ill"],
};

function makeReport(overrides: Partial<HeirHealthAnomalyPublicReport> = {}): HeirHealthAnomalyPublicReport {
  return {
    id: "iarep_heir_health_heir_001_abc",
    source: { kind: "investigation_incident", incidentId: INCIDENT.id },
    reportKind: "anomaly",
    eventFamily: "heir_health_anomaly",
    createdAt: AT,
    status: "unread",
    knownTargetIds: ["heir_001"],
    suspectedActorIds: ["sus_1"],
    confidence: "plausible",
    symptomCode: "hysteria",
    publicFactCodes: ["heir_fell_ill"],
    accuserIds: ["acc_1"],
    ...overrides,
  };
}

function codes(reports: InvestigationPublicReport[], cases: IntrigueInvestigationCase[] = []): string[] {
  return validateInvestigationPublicReports({ reports, incidents: [INCIDENT], cases }).map((e) => e.code);
}

describe("validateInvestigationPublicReports", () => {
  it("PRV-01: 合法 unread 报告无错误", () => {
    expect(codes([makeReport()])).toEqual([]);
  });

  it("PRV-02: 重复 id", () => {
    expect(codes([makeReport(), makeReport()])).toContain("INVESTIGATION_REPORT_DUP_ID");
  });

  it("PRV-03: 孤儿 incident（source.incidentId 不存在）", () => {
    const r = makeReport({ source: { kind: "investigation_incident", incidentId: "ghost" } });
    expect(codes([r])).toContain("INVESTIGATION_REPORT_ORPHAN_INCIDENT");
  });

  it("PRV-04: symptom 与 incident 不一致", () => {
    expect(codes([makeReport({ symptomCode: "high_fever" })])).toContain("INVESTIGATION_REPORT_SYMPTOM_MISMATCH");
  });

  it("PRV-05: knownTargetIds 不等于 [victimHeirId]", () => {
    expect(codes([makeReport({ knownTargetIds: ["heir_001", "heir_002"] })])).toContain("INVESTIGATION_REPORT_TARGET_MISMATCH");
  });

  it("PRV-06: accuserIds / suspectedActorIds 与 incident 不一致", () => {
    expect(codes([makeReport({ accuserIds: ["other"] })])).toContain("INVESTIGATION_REPORT_ACCUSER_MISMATCH");
    expect(codes([makeReport({ suspectedActorIds: ["other"] })])).toContain("INVESTIGATION_REPORT_ACCUSED_MISMATCH");
  });

  it("PRV-07: unread 不得有 acknowledgedAt / linkedInvestigationId", () => {
    expect(codes([makeReport({ status: "unread", acknowledgedAt: AT })])).toContain("INVESTIGATION_REPORT_LIFECYCLE");
    expect(codes([makeReport({ status: "unread", linkedInvestigationId: "icase_x" })])).toContain("INVESTIGATION_REPORT_LIFECYCLE");
  });

  it("PRV-08: acknowledged 必须有 acknowledgedAt 且无 linkedInvestigationId", () => {
    expect(codes([makeReport({ status: "acknowledged" })])).toContain("INVESTIGATION_REPORT_LIFECYCLE");
    expect(codes([makeReport({ status: "acknowledged", acknowledgedAt: AT })])).toEqual([]);
    expect(codes([makeReport({ status: "acknowledged", acknowledgedAt: AT, linkedInvestigationId: "icase_x" })])).toContain("INVESTIGATION_REPORT_LIFECYCLE");
  });

  it("PRV-09: investigating 必须有 acknowledgedAt 且有 linkedInvestigationId（且 case 链接一致）", () => {
    // 缺 linkedInvestigationId
    expect(codes([makeReport({ status: "investigating", acknowledgedAt: AT })])).toContain("INVESTIGATION_REPORT_LIFECYCLE");

    // 完整且 case 一致 → 无错误
    const report = makeReport({ status: "investigating", acknowledgedAt: AT, linkedInvestigationId: "icase_iarep_heir_health_heir_001_abc" });
    const linkedCase: IntrigueInvestigationCase = {
      id: "icase_iarep_heir_health_heir_001_abc",
      source: { kind: "investigation_incident", reportId: report.id, incidentId: INCIDENT.id },
      openedAt: AT,
      openedFromReportKind: "anomaly",
      status: "open",
      knownTargetIds: ["heir_001"],
      suspectIds: ["sus_1"],
      suspectedKinds: [],
      confidence: "plausible",
      leadIds: [],
    };
    expect(codes([report], [linkedCase])).toEqual([]);
  });

  it("PRV-10: investigating 但链接案件 source.kind/reportId/incidentId 不一致 → BROKEN_LINK", () => {
    const report = makeReport({ status: "investigating", acknowledgedAt: AT, linkedInvestigationId: "icase_bad" });
    const wrongCase: IntrigueInvestigationCase = {
      id: "icase_bad",
      source: { kind: "legacy_intrigue", reportId: "someone_else", incidentId: "other_incident" },
      openedAt: AT,
      openedFromReportKind: "exposure",
      status: "open",
      knownTargetIds: ["heir_001"],
      suspectIds: [],
      suspectedKinds: [],
      confidence: "plausible",
      leadIds: [],
    };
    expect(codes([report], [wrongCase])).toContain("INVESTIGATION_REPORT_BROKEN_LINK");
  });

  it("PRV-11: linkedInvestigationId 指向不存在案件 → BROKEN_LINK", () => {
    const report = makeReport({ status: "investigating", acknowledgedAt: AT, linkedInvestigationId: "icase_ghost" });
    expect(codes([report])).toContain("INVESTIGATION_REPORT_BROKEN_LINK");
  });
});
