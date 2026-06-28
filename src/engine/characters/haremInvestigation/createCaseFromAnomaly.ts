/**
 * 从皇嗣异常公开报告立案（Phase 5B-2B1）。
 *
 * 纯函数：读取 investigationPublicReports，建立 source.kind="investigation_incident"
 * 的调查案件。初始知识完全复制自公开报告，不读取 investigationTruths。
 *
 * 本阶段只做来源桥接，不改变任务结算逻辑（结算器在 5B-2B2 接入证据模型）。
 */
import { ok, err, type Result } from "../../infra/result";
import { stateError, type GameError } from "../../infra/errors";
import type { GameState } from "../../state/types";
import type { GameTime } from "../../calendar/time";
import type { IntrigueInvestigationCase } from "./types";

export function createInvestigationCaseFromAnomalyReport(
  state: GameState,
  reportId: string,
  at: GameTime,
): Result<{ state: GameState; caseId: string }, GameError[]> {
  const _r = state.investigationPublicReports.find((r) => r.id === reportId);
  if (!_r) {
    return err([stateError("INVESTIGATION_PUBLIC_REPORT_NOT_FOUND", `investigationPublicReports: report "${reportId}" not found`)]);
  }
  if (_r.reportKind !== "anomaly") {
    return err([stateError("INVESTIGATION_PUBLIC_REPORT_NOT_FOUND", `investigationPublicReports: report "${reportId}" reportKind="${_r.reportKind}" is not an anomaly report`)]);
  }
  const report = _r;

  // 写状态前确认底层 incident 存在，避免先建出孤儿案件、直到存档校验才失败
  const incident = state.investigationIncidents.find((i) => i.id === report.source.incidentId);
  if (!incident) {
    return err([stateError("INVESTIGATION_REPORT_ORPHAN_INCIDENT", `investigationPublicReports[id=${reportId}]: source.incidentId="${report.source.incidentId}" 在 investigationIncidents 中不存在，无法立案`)]);
  }

  // 幂等：报告已链接到现有案件 → 返回已有 caseId
  if (report.linkedInvestigationId) {
    const existing = state.haremInvestigationCases.find((c) => c.id === report.linkedInvestigationId);
    if (existing) {
      return ok({ state, caseId: existing.id });
    }
    return err([stateError("INTRIGUE_CASE_CREATE_FAILED", `report "${reportId}" linkedInvestigationId="${report.linkedInvestigationId}" points to non-existent case`)]);
  }

  const caseId = `icase_${reportId}`;
  if (state.haremInvestigationCases.some((c) => c.id === caseId)) {
    return err([stateError("INTRIGUE_CASE_DUPLICATE_ID", `haremInvestigationCases: case id="${caseId}" already exists`)]);
  }

  const acknowledgedAt = report.acknowledgedAt ?? at;

  const newCase: IntrigueInvestigationCase = {
    id: caseId,
    source: {
      kind: "investigation_incident",
      reportId: report.id,
      incidentId: report.source.incidentId,
    },
    openedAt: at,
    openedFromReportKind: report.reportKind,
    // confirmed 报告立案时直接进入 ready_for_review，与旧链路一致
    status: report.confidence === "confirmed" ? "ready_for_review" : "open",
    knownTargetIds: [...report.knownTargetIds],
    suspectIds: [...report.suspectedActorIds],
    // 皇嗣异常案件的"手段"由证据驱动（5B-2B2 填充），立案时为空
    suspectedKinds: [],
    confidence: report.confidence,
    leadIds: [],
  };

  const updatedReports = state.investigationPublicReports.map((r) =>
    r.id === reportId && r.reportKind === "anomaly"
      ? { ...r, status: "investigating" as const, acknowledgedAt, linkedInvestigationId: caseId }
      : r,
  );

  return ok({
    state: {
      ...state,
      investigationPublicReports: updatedReports,
      haremInvestigationCases: [...state.haremInvestigationCases, newCase],
    },
    caseId,
  });
}
