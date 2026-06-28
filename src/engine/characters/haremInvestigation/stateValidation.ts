/**
 * 调查案件集合级链接完整性校验（Phase 5B-1A）。
 * 在 stateSchema superRefine 中调用。
 */
import { stateError, type GameError } from "../../infra/errors";
import type { HaremIntrigueReport } from "../../state/types";
import type { IntrigueInvestigationCase } from "./types";
import { isActiveCase } from "./types";

const NON_INVESTIGATABLE_KINDS = new Set(["investigation_update", "investigation_final"]);

export interface HaremInvestigationValidationInput {
  haremIntrigueReports: HaremIntrigueReport[];
  haremInvestigationCases: IntrigueInvestigationCase[];
  incidentIds: Set<string>;
}

export function validateHaremInvestigationLinks(
  data: HaremInvestigationValidationInput,
): GameError[] {
  const errors: GameError[] = [];
  const { haremIntrigueReports, haremInvestigationCases, incidentIds } = data;

  const reportById = new Map(haremIntrigueReports.map((r) => [r.id, r]));
  const caseIds = new Set<string>();

  for (const c of haremInvestigationCases) {
    // 唯一性
    if (caseIds.has(c.id)) {
      errors.push(stateError("INTRIGUE_DUP_CASE", `haremInvestigationCases: 重复 id="${c.id}"`));
    }
    caseIds.add(c.id);

    // source.reportId 必须存在
    const report = reportById.get(c.source.reportId);
    if (!report) {
      errors.push(stateError("INTRIGUE_CASE_ORPHAN_REPORT", `haremInvestigationCases[id=${c.id}]: source.reportId="${c.source.reportId}" 不存在`));
    }

    // case → report 反向链接：report 必须指回此 case
    if (report && report.linkedInvestigationId !== c.id) {
      errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremInvestigationCases[id=${c.id}]: source report 的 linkedInvestigationId="${report.linkedInvestigationId ?? "(undefined)"}" 未反向链接此案件`));
    }

    // source.incidentId 必须存在
    if (!incidentIds.has(c.source.incidentId)) {
      errors.push(stateError("INTRIGUE_CASE_ORPHAN_INCIDENT", `haremInvestigationCases[id=${c.id}]: source.incidentId="${c.source.incidentId}" 不存在`));
    }

    // source.incidentId 与 report 一致
    if (report && report.source.incidentId !== c.source.incidentId) {
      errors.push(stateError("INTRIGUE_CASE_INCIDENT_MISMATCH", `haremInvestigationCases[id=${c.id}]: source.incidentId 与 report.source.incidentId 不一致`));
    }

    // openedFromReportKind 不得为不可立案种类
    if (NON_INVESTIGATABLE_KINDS.has(c.openedFromReportKind)) {
      errors.push(stateError("INTRIGUE_CASE_INVALID_KIND", `haremInvestigationCases[id=${c.id}]: openedFromReportKind="${c.openedFromReportKind}" 是不可立案报告种类`));
    }

    // openedFromReportKind 必须与来源 report 一致
    if (report && report.reportKind !== c.openedFromReportKind) {
      errors.push(stateError("INTRIGUE_CASE_KIND_MISMATCH", `haremInvestigationCases[id=${c.id}]: openedFromReportKind="${c.openedFromReportKind}" 与 report.reportKind="${report.reportKind}" 不一致`));
    }

    // knownTargetIds 不为空
    if (c.knownTargetIds.length === 0) {
      errors.push(stateError("INTRIGUE_CASE_NO_TARGET", `haremInvestigationCases[id=${c.id}]: knownTargetIds 为空`));
    }

    // leadIds 唯一
    const leadSet = new Set<string>();
    for (const lid of c.leadIds) {
      if (leadSet.has(lid)) {
        errors.push(stateError("INTRIGUE_CASE_DUP_LEAD", `haremInvestigationCases[id=${c.id}]: 重复 leadId="${lid}"`));
      }
      leadSet.add(lid);
    }

    // active ↔ 无 closedAt/closureReason
    if (isActiveCase(c.status)) {
      if (c.closedAt) {
        errors.push(stateError("INTRIGUE_CASE_LIFECYCLE", `haremInvestigationCases[id=${c.id}]: status=${c.status} 但有 closedAt`));
      }
      if (c.closureReason) {
        errors.push(stateError("INTRIGUE_CASE_LIFECYCLE", `haremInvestigationCases[id=${c.id}]: status=${c.status} 但有 closureReason`));
      }
    } else {
      // closed/cancelled → 必须有 closedAt 和 closureReason
      if (!c.closedAt) {
        errors.push(stateError("INTRIGUE_CASE_LIFECYCLE", `haremInvestigationCases[id=${c.id}]: status=${c.status} 但无 closedAt`));
      }
      if (!c.closureReason) {
        errors.push(stateError("INTRIGUE_CASE_LIFECYCLE", `haremInvestigationCases[id=${c.id}]: status=${c.status} 但无 closureReason`));
      }
    }
  }

  // Report ↔ Case 双向链接
  for (const report of haremIntrigueReports) {
    if (!report.linkedInvestigationId) continue;
    const linkedCase = haremInvestigationCases.find((c) => c.id === report.linkedInvestigationId);
    if (!linkedCase) {
      errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremIntrigueReports[id=${report.id}]: linkedInvestigationId="${report.linkedInvestigationId}" 对应 case 不存在`));
      continue;
    }
    // 反向：case.source.reportId === report.id
    if (linkedCase.source.reportId !== report.id) {
      errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremIntrigueReports[id=${report.id}]: case.source.reportId="${linkedCase.source.reportId}" 与 report.id 不一致`));
    }
    // 有 case 的 report 必须是 actioned/investigating/acknowledgedAt
    if (report.status !== "actioned") {
      errors.push(stateError("INTRIGUE_CASE_REPORT_STATUS", `haremIntrigueReports[id=${report.id}]: linkedInvestigationId 存在但 status="${report.status}"，期望 actioned`));
    }
    if (report.action !== "investigating") {
      errors.push(stateError("INTRIGUE_CASE_REPORT_STATUS", `haremIntrigueReports[id=${report.id}]: linkedInvestigationId 存在但 action="${report.action}"，期望 investigating`));
    }
    if (!report.acknowledgedAt) {
      errors.push(stateError("INTRIGUE_CASE_REPORT_STATUS", `haremIntrigueReports[id=${report.id}]: linkedInvestigationId 存在但无 acknowledgedAt`));
    }
  }

  return errors;
}
