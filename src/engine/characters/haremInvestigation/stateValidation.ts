/**
 * 调查案件集合级链接完整性校验（Phase 5B-1A + 5B-2）。
 * 在 stateSchema superRefine 中调用。
 */
import { stateError, type GameError } from "../../infra/errors";
import type { HaremIntrigueReport } from "../../state/types";
import type { IntrigueInvestigationCase, IntrigueInvestigationTask, IntrigueInvestigationLead, InvestigationPublicReport } from "./types";
import { isActiveCase, EVIDENCE_INVESTIGATION_METHODS, LEGACY_INVESTIGATION_METHODS } from "./types";
import type { HeirHealthAnomalyIncident, InvestigationTruth } from "./truth/types";

const NON_INVESTIGATABLE_KINDS = new Set(["investigation_update", "investigation_final"]);

export interface HaremInvestigationValidationInput {
  haremIntrigueReports: HaremIntrigueReport[];
  haremInvestigationCases: IntrigueInvestigationCase[];
  haremInvestigationTasks: Record<string, IntrigueInvestigationTask>;
  haremInvestigationLeads: Record<string, IntrigueInvestigationLead>;
  haremInvestigationNextSeq: number;
  /** 旧宫斗事件 ID 集合（haremIncidents）。 */
  incidentIds: Set<string>;
  /** 皇嗣异常等新事件族公开报告（5B-2B）。缺省视为空。 */
  investigationPublicReports?: InvestigationPublicReport[];
  /** 新事件族 incident ID 集合（investigationIncidents）。缺省视为空。 */
  investigationIncidentIds?: Set<string>;
  /** 后台真相（用于校验证据线索的 sourceEvidenceNodeId 引用完整性，5B-2B2a）。缺省视为空。 */
  investigationTruths?: InvestigationTruth[];
}

export function validateHaremInvestigationLinks(
  data: HaremInvestigationValidationInput,
): GameError[] {
  const errors: GameError[] = [];
  const { haremIntrigueReports, haremInvestigationCases, haremInvestigationTasks, haremInvestigationLeads, haremInvestigationNextSeq, incidentIds } = data;
  const investigationPublicReports = data.investigationPublicReports ?? [];
  const investigationIncidentIds = data.investigationIncidentIds ?? new Set<string>();
  const investigationTruths = data.investigationTruths ?? [];

  const reportById = new Map(haremIntrigueReports.map((r) => [r.id, r]));
  const publicReportById = new Map(investigationPublicReports.map((r) => [r.id, r]));
  const caseById = new Map(haremInvestigationCases.map((c) => [c.id, c]));
  const truthByIncidentId = new Map(investigationTruths.map((t) => [t.incidentId, t]));
  const caseIds = new Set<string>();

  for (const c of haremInvestigationCases) {
    // 唯一性
    if (caseIds.has(c.id)) {
      errors.push(stateError("INTRIGUE_DUP_CASE", `haremInvestigationCases: 重复 id="${c.id}"`));
    }
    caseIds.add(c.id);

    // 按事件族来源解析 report / incident 集合
    // 归一化为 { linkedInvestigationId, incidentId, reportKind } 以复用一致性检查
    const sourceReport: { linkedInvestigationId?: string; incidentId: string; reportKind: string } | undefined =
      c.source.kind === "legacy_intrigue"
        ? (() => {
            const r = reportById.get(c.source.reportId);
            return r ? { linkedInvestigationId: r.linkedInvestigationId, incidentId: r.source.incidentId, reportKind: r.reportKind } : undefined;
          })()
        : (() => {
            const r = publicReportById.get(c.source.reportId);
            return r ? { linkedInvestigationId: r.linkedInvestigationId, incidentId: r.source.incidentId, reportKind: r.reportKind } : undefined;
          })();
    const incidentSet = c.source.kind === "legacy_intrigue" ? incidentIds : investigationIncidentIds;

    // source.reportId 必须存在
    if (!sourceReport) {
      errors.push(stateError("INTRIGUE_CASE_ORPHAN_REPORT", `haremInvestigationCases[id=${c.id}]: source.reportId="${c.source.reportId}" 不存在`));
    }

    // case → report 反向链接：report 必须指回此 case
    if (sourceReport && sourceReport.linkedInvestigationId !== c.id) {
      errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremInvestigationCases[id=${c.id}]: source report 的 linkedInvestigationId="${sourceReport.linkedInvestigationId ?? "(undefined)"}" 未反向链接此案件`));
    }

    // source.incidentId 必须存在
    if (!incidentSet.has(c.source.incidentId)) {
      errors.push(stateError("INTRIGUE_CASE_ORPHAN_INCIDENT", `haremInvestigationCases[id=${c.id}]: source.incidentId="${c.source.incidentId}" 不存在`));
    }

    // source.incidentId 与 report 一致
    if (sourceReport && sourceReport.incidentId !== c.source.incidentId) {
      errors.push(stateError("INTRIGUE_CASE_INCIDENT_MISMATCH", `haremInvestigationCases[id=${c.id}]: source.incidentId 与 report.source.incidentId 不一致`));
    }

    // openedFromReportKind 不得为不可立案种类
    if (NON_INVESTIGATABLE_KINDS.has(c.openedFromReportKind)) {
      errors.push(stateError("INTRIGUE_CASE_INVALID_KIND", `haremInvestigationCases[id=${c.id}]: openedFromReportKind="${c.openedFromReportKind}" 是不可立案报告种类`));
    }

    // openedFromReportKind 必须与来源 report 一致
    if (sourceReport && sourceReport.reportKind !== c.openedFromReportKind) {
      errors.push(stateError("INTRIGUE_CASE_KIND_MISMATCH", `haremInvestigationCases[id=${c.id}]: openedFromReportKind="${c.openedFromReportKind}" 与 report.reportKind="${sourceReport.reportKind}" 不一致`));
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

  // ── case.leadIds 双向链接 + B3 confirmedCulpritId ──────────────────
  for (const c of haremInvestigationCases) {
    // leadIds 中每个 ID 必须在 haremInvestigationLeads 中存在
    for (const lid of c.leadIds) {
      const lead = haremInvestigationLeads[lid];
      if (!lead) {
        errors.push(stateError("INTRIGUE_LEAD_MISSING", `haremInvestigationCases[id=${c.id}]: leadId="${lid}" 在 haremInvestigationLeads 中不存在`));
      } else if (lead.caseId !== c.id) {
        errors.push(stateError("INTRIGUE_LEAD_CASE_MISMATCH", `haremInvestigationLeads[id=${lid}]: caseId="${lead.caseId}" 与 case.id="${c.id}" 不一致`));
      }
    }

    // B3：closed_confirmed → 必须有 confirmedCulpritId；confirmedCulpritId 必须在 suspectIds 中
    if (c.status === "closed_confirmed") {
      if (!c.confirmedCulpritId) {
        errors.push(stateError("INTRIGUE_CASE_MISSING_CULPRIT", `haremInvestigationCases[id=${c.id}]: status=closed_confirmed 但无 confirmedCulpritId`));
      } else if (!c.suspectIds.includes(c.confirmedCulpritId)) {
        errors.push(stateError("INTRIGUE_CASE_CULPRIT_NOT_SUSPECT", `haremInvestigationCases[id=${c.id}]: confirmedCulpritId="${c.confirmedCulpritId}" 不在 suspectIds 中`));
      }
      if (c.closureReason !== "culprit_confirmed") {
        errors.push(stateError("INTRIGUE_CASE_CLOSURE_REASON", `haremInvestigationCases[id=${c.id}]: status=closed_confirmed 但 closureReason="${c.closureReason}"，期望 culprit_confirmed`));
      }
    } else if (c.confirmedCulpritId) {
      errors.push(stateError("INTRIGUE_CASE_CULPRIT_WRONG_STATUS", `haremInvestigationCases[id=${c.id}]: status=${c.status} 不得有 confirmedCulpritId`));
    }

    // 全状态 closureReason 约束
    if (c.status === "closed_unresolved" && c.closureReason && c.closureReason !== "insufficient_evidence") {
      errors.push(stateError("INTRIGUE_CASE_CLOSURE_REASON", `haremInvestigationCases[id=${c.id}]: status=closed_unresolved 但 closureReason="${c.closureReason}"，期望 insufficient_evidence`));
    }
    if (c.status === "cancelled" && c.closureReason && c.closureReason !== "player_cancelled") {
      errors.push(stateError("INTRIGUE_CASE_CLOSURE_REASON", `haremInvestigationCases[id=${c.id}]: status=cancelled 但 closureReason="${c.closureReason}"，期望 player_cancelled`));
    }

    // 5B-2B2b：closed_explained → benign_cause_confirmed + confirmedBenignCause；其余状态不得有 confirmedBenignCause
    if (c.status === "closed_explained") {
      if (c.closureReason !== "benign_cause_confirmed") {
        errors.push(stateError("INTRIGUE_CASE_CLOSURE_REASON", `haremInvestigationCases[id=${c.id}]: status=closed_explained 但 closureReason="${c.closureReason}"，期望 benign_cause_confirmed`));
      }
      if (!c.confirmedBenignCause) {
        errors.push(stateError("INTRIGUE_CASE_MISSING_BENIGN_CAUSE", `haremInvestigationCases[id=${c.id}]: status=closed_explained 但无 confirmedBenignCause`));
      }
    } else if (c.confirmedBenignCause) {
      errors.push(stateError("INTRIGUE_CASE_BENIGN_WRONG_STATUS", `haremInvestigationCases[id=${c.id}]: status=${c.status} 不得有 confirmedBenignCause`));
    }

    // B2：in_progress 案件 → 恰好 1 个 pending task
    if (c.status === "in_progress") {
      const pendingCount = Object.values(haremInvestigationTasks).filter(
        (t) => t.caseId === c.id && t.status === "pending",
      ).length;
      if (pendingCount !== 1) {
        errors.push(stateError("INTRIGUE_CASE_PENDING_TASK_COUNT", `haremInvestigationCases[id=${c.id}]: status=in_progress 但 pending task 数量=${pendingCount}，期望 1`));
      }
    }
  }

  // ── Task 完整性校验 ────────────────────────────────────────────────
  for (const [key, task] of Object.entries(haremInvestigationTasks)) {
    // Record key 必须等于对象内部 id
    if (key !== task.id) {
      errors.push(stateError("INTRIGUE_TASK_KEY_MISMATCH", `haremInvestigationTasks: key="${key}" 与 task.id="${task.id}" 不一致`));
    }
    // caseId 必须存在
    if (!caseIds.has(task.caseId)) {
      errors.push(stateError("INTRIGUE_TASK_ORPHAN", `haremInvestigationTasks[id=${task.id}]: caseId="${task.caseId}" 对应案件不存在`));
    }
    // 5B-2B2a：调查方法必须与案件来源匹配（两套模型不得混用）
    const taskCase = haremInvestigationCases.find((c) => c.id === task.caseId);
    if (taskCase) {
      const isEvidence = taskCase.source.kind === "investigation_incident";
      if (isEvidence && !EVIDENCE_INVESTIGATION_METHODS.has(task.method)) {
        errors.push(stateError("INTRIGUE_TASK_METHOD_SOURCE_MISMATCH", `haremInvestigationTasks[id=${task.id}]: method="${task.method}" 不适用于证据驱动案件`));
      }
      if (!isEvidence && !LEGACY_INVESTIGATION_METHODS.has(task.method)) {
        errors.push(stateError("INTRIGUE_TASK_METHOD_SOURCE_MISMATCH", `haremInvestigationTasks[id=${task.id}]: method="${task.method}" 不适用于旧宫斗案件`));
      }
      // 证据调查任务为非对象型，subjectId 不得持久化
      if (isEvidence && task.subjectId !== undefined) {
        errors.push(stateError("INTRIGUE_TASK_METHOD_SOURCE_MISMATCH", `haremInvestigationTasks[id=${task.id}]: 证据驱动任务不允许 subjectId`));
      }
    }
    // pending task 不得有 resolvedAt / leadId
    if (task.status === "pending") {
      if (task.resolvedAt) {
        errors.push(stateError("INTRIGUE_TASK_LIFECYCLE", `haremInvestigationTasks[id=${task.id}]: status=pending 但有 resolvedAt`));
      }
      if (task.leadId) {
        errors.push(stateError("INTRIGUE_TASK_LIFECYCLE", `haremInvestigationTasks[id=${task.id}]: status=pending 但有 leadId`));
      }
      // pending task → case.status 必须是 in_progress（B2 integrity）
      const taskCase = haremInvestigationCases.find((c) => c.id === task.caseId);
      if (taskCase && taskCase.status !== "in_progress") {
        errors.push(stateError("INTRIGUE_TASK_CASE_STATUS", `haremInvestigationTasks[id=${task.id}]: status=pending 但 case.status="${taskCase.status}"，期望 in_progress`));
      }
    }
    // resolved task → 必须有 resolvedAt + leadId
    if (task.status === "resolved") {
      if (!task.resolvedAt) {
        errors.push(stateError("INTRIGUE_TASK_LIFECYCLE", `haremInvestigationTasks[id=${task.id}]: status=resolved 但无 resolvedAt`));
      }
      if (!task.leadId) {
        errors.push(stateError("INTRIGUE_TASK_LIFECYCLE", `haremInvestigationTasks[id=${task.id}]: status=resolved 但无 leadId`));
      }
      if (task.leadId && !haremInvestigationLeads[task.leadId]) {
        errors.push(stateError("INTRIGUE_TASK_ORPHAN_LEAD", `haremInvestigationTasks[id=${task.id}]: leadId="${task.leadId}" 对应线索不存在`));
      }
      // task.leadId 对应的 lead.caseId 必须等于 task.caseId
      if (task.leadId) {
        const linkedLead = haremInvestigationLeads[task.leadId];
        if (linkedLead && linkedLead.caseId !== task.caseId) {
          errors.push(stateError("INTRIGUE_TASK_LEAD_CASE_MISMATCH", `haremInvestigationTasks[id=${task.id}]: leadId="${task.leadId}" 的 lead.caseId="${linkedLead.caseId}" 与 task.caseId="${task.caseId}" 不一致`));
        }
      }
    }
  }

  // ── Lead 完整性校验 ───────────────────────────────────────────────
  for (const [key, lead] of Object.entries(haremInvestigationLeads)) {
    // Record key 必须等于对象内部 id
    if (key !== lead.id) {
      errors.push(stateError("INTRIGUE_LEAD_KEY_MISMATCH", `haremInvestigationLeads: key="${key}" 与 lead.id="${lead.id}" 不一致`));
    }
    // lead.caseId 必须存在
    if (!caseIds.has(lead.caseId)) {
      errors.push(stateError("INTRIGUE_LEAD_ORPHAN", `haremInvestigationLeads[id=${lead.id}]: caseId="${lead.caseId}" 对应案件不存在`));
    }
    // lead.id 必须出现在其 case.leadIds 中（反向引用）
    const parentCase = caseById.get(lead.caseId);
    if (parentCase && !parentCase.leadIds.includes(lead.id)) {
      errors.push(stateError("INTRIGUE_LEAD_NOT_IN_CASE", `haremInvestigationLeads[id=${lead.id}]: 未出现在 case[id=${lead.caseId}].leadIds 中`));
    }

    // ── 5B-2B2a：证据线索引用完整性 ────────────────────────────────
    const isEvidenceCase = parentCase?.source.kind === "investigation_incident";

    // 旧宫斗案件线索不得携带证据字段
    if (parentCase && !isEvidenceCase) {
      if (lead.sourceEvidenceNodeId !== undefined) {
        errors.push(stateError("INTRIGUE_LEAD_EVIDENCE_ON_LEGACY", `haremInvestigationLeads[id=${lead.id}]: 旧宫斗案件线索不得有 sourceEvidenceNodeId`));
      }
      if (lead.claims !== undefined) {
        errors.push(stateError("INTRIGUE_LEAD_EVIDENCE_ON_LEGACY", `haremInvestigationLeads[id=${lead.id}]: 旧宫斗案件线索不得有 claims`));
      }
    }

    // claims ↔ implicated/cleared 派生字段一致性
    if (lead.claims) {
      const claimImplicated = new Set(lead.claims.filter((cl) => cl.kind === "implicates_character").map((cl) => (cl as { characterId: string }).characterId));
      const claimCleared = new Set(lead.claims.filter((cl) => cl.kind === "exonerates_character").map((cl) => (cl as { characterId: string }).characterId));
      for (const id of lead.implicatedIds) {
        if (!claimImplicated.has(id)) errors.push(stateError("INTRIGUE_LEAD_CLAIM_MISMATCH", `haremInvestigationLeads[id=${lead.id}]: implicatedIds 含 "${id}" 但 claims 无对应 implicates_character`));
      }
      for (const id of lead.clearedIds) {
        if (!claimCleared.has(id)) errors.push(stateError("INTRIGUE_LEAD_CLAIM_MISMATCH", `haremInvestigationLeads[id=${lead.id}]: clearedIds 含 "${id}" 但 claims 无对应 exonerates_character`));
      }
    }

    // sourceEvidenceNodeId 引用：节点须属于该案件 truth，且方法匹配
    if (lead.sourceEvidenceNodeId !== undefined && parentCase && isEvidenceCase) {
      const truth = truthByIncidentId.get(parentCase.source.incidentId);
      if (!truth) {
        errors.push(stateError("INTRIGUE_LEAD_EVIDENCE_NO_TRUTH", `haremInvestigationLeads[id=${lead.id}]: 案件 incident="${parentCase.source.incidentId}" 无对应 truth，无法核对 sourceEvidenceNodeId`));
      } else {
        const node = truth.evidenceNodes.find((n) => n.id === lead.sourceEvidenceNodeId);
        if (!node) {
          errors.push(stateError("INTRIGUE_LEAD_EVIDENCE_ORPHAN_NODE", `haremInvestigationLeads[id=${lead.id}]: sourceEvidenceNodeId="${lead.sourceEvidenceNodeId}" 不属于本案 truth`));
        } else if (!(node.discoverableBy as string[]).includes(lead.method)) {
          errors.push(stateError("INTRIGUE_LEAD_EVIDENCE_METHOD_MISMATCH", `haremInvestigationLeads[id=${lead.id}]: 节点 discoverableBy 不含 lead.method="${lead.method}"`));
        }
      }
    }
  }

  // 同一案件内 sourceEvidenceNodeId 不得重复（一个证据节点至多被发现一次）
  const caseNodeSeen = new Map<string, Set<string>>();
  for (const lead of Object.values(haremInvestigationLeads)) {
    if (lead.sourceEvidenceNodeId === undefined) continue;
    const seen = caseNodeSeen.get(lead.caseId) ?? new Set<string>();
    if (seen.has(lead.sourceEvidenceNodeId)) {
      errors.push(stateError("INTRIGUE_LEAD_EVIDENCE_DUP_NODE", `haremInvestigationLeads: case "${lead.caseId}" 的证据节点 "${lead.sourceEvidenceNodeId}" 被重复发现`));
    }
    seen.add(lead.sourceEvidenceNodeId);
    caseNodeSeen.set(lead.caseId, seen);
  }


  // ── haremInvestigationNextSeq 下界校验 ───────────────────────────
  // nextSeq 必须严格大于已有 task/lead 中最大序号
  const extractSeq = (id: string): number => {
    const m = id.match(/(\d{6})$/);
    return m ? parseInt(m[1]!, 10) : 0;
  };
  const maxTaskSeq = Math.max(0, ...Object.keys(haremInvestigationTasks).map(extractSeq));
  const maxLeadSeq = Math.max(0, ...Object.keys(haremInvestigationLeads).map(extractSeq));
  const maxUsedSeq = Math.max(maxTaskSeq, maxLeadSeq);
  if (haremInvestigationNextSeq <= maxUsedSeq) {
    errors.push(stateError("INTRIGUE_SEQ_TOO_LOW", `haremInvestigationNextSeq=${haremInvestigationNextSeq} 必须大于已使用最大序号 ${maxUsedSeq}`));
  }

  // Report ↔ Case 双向链接
  for (const report of haremIntrigueReports) {
    if (!report.linkedInvestigationId) continue;
    const linkedCase = haremInvestigationCases.find((c) => c.id === report.linkedInvestigationId);
    if (!linkedCase) {
      errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremIntrigueReports[id=${report.id}]: linkedInvestigationId="${report.linkedInvestigationId}" 对应 case 不存在`));
      continue;
    }

    // 调查进展通报（investigation_update/final）：仅校验 incidentId 匹配，不要求 actioned 状态
    if (report.reportKind === "investigation_update" || report.reportKind === "investigation_final") {
      if (report.source.incidentId !== linkedCase.source.incidentId) {
        errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremIntrigueReports[id=${report.id}]: source.incidentId="${report.source.incidentId}" 与 case.source.incidentId="${linkedCase.source.incidentId}" 不一致`));
      }
      continue;
    }

    // 立案来源报告（anomaly/rumor/exposure）：完整双向校验
    if (linkedCase.source.reportId !== report.id) {
      errors.push(stateError("INTRIGUE_CASE_BROKEN_LINK", `haremIntrigueReports[id=${report.id}]: case.source.reportId="${linkedCase.source.reportId}" 与 report.id 不一致`));
    }
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

  // 公开报告 ↔ 案件的完整性、生命周期与字段一致性校验另见
  // validateInvestigationPublicReports（独立校验器，覆盖孤儿报告与非法生命周期）。

  return errors;
}

// ── 5B-2B1：皇嗣异常公开报告完整性 + 生命周期校验 ──────────────────────

export interface InvestigationPublicReportValidationInput {
  reports: InvestigationPublicReport[];
  incidents: HeirHealthAnomalyIncident[];
  cases: IntrigueInvestigationCase[];
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 校验公开报告自身完整性、与底层 incident 字段一致性、生命周期不变量，
 * 以及与立案案件的双向链接。覆盖未立案（无 linkedInvestigationId）的孤儿/
 * 非法状态——这些此前会绕过 validateHaremInvestigationLinks。
 */
export function validateInvestigationPublicReports(
  data: InvestigationPublicReportValidationInput,
): GameError[] {
  const errors: GameError[] = [];
  const { reports, incidents, cases } = data;
  const incidentById = new Map(incidents.map((i) => [i.id, i]));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const seenIds = new Set<string>();

  for (const r of reports) {
    // id 唯一
    if (seenIds.has(r.id)) {
      errors.push(stateError("INVESTIGATION_REPORT_DUP_ID", `investigationPublicReports: 重复 id="${r.id}"`));
    }
    seenIds.add(r.id);

    // source.incidentId 必须存在（两类报告通用）
    const incident = incidentById.get(r.source.incidentId);
    if (!incident) {
      errors.push(stateError("INVESTIGATION_REPORT_ORPHAN_INCIDENT", `investigationPublicReports[id=${r.id}]: source.incidentId="${r.source.incidentId}" 在 investigationIncidents 中不存在`));
    }

    if (r.reportKind === "anomaly") {
      // ── 立案报告（HeirHealthAnomalyPublicReport）─────────────────────
      if (incident) {
        // 与 incident 字段一致性（脱敏映射不得篡改公开事实）
        if (r.eventFamily !== incident.eventFamily) {
          errors.push(stateError("INVESTIGATION_REPORT_FAMILY_MISMATCH", `investigationPublicReports[id=${r.id}]: eventFamily="${r.eventFamily}" 与 incident="${incident.eventFamily}" 不一致`));
        }
        if (r.symptomCode !== incident.symptom) {
          errors.push(stateError("INVESTIGATION_REPORT_SYMPTOM_MISMATCH", `investigationPublicReports[id=${r.id}]: symptomCode="${r.symptomCode}" 与 incident.symptom="${incident.symptom}" 不一致`));
        }
        if (!arrEq(r.knownTargetIds, [incident.victimHeirId])) {
          errors.push(stateError("INVESTIGATION_REPORT_TARGET_MISMATCH", `investigationPublicReports[id=${r.id}]: knownTargetIds 必须恰为 [incident.victimHeirId="${incident.victimHeirId}"]`));
        }
        if (!arrEq(r.accuserIds, incident.accuserIds)) {
          errors.push(stateError("INVESTIGATION_REPORT_ACCUSER_MISMATCH", `investigationPublicReports[id=${r.id}]: accuserIds 与 incident.accuserIds 不一致`));
        }
        if (!arrEq(r.suspectedActorIds, incident.initiallyAccusedIds)) {
          errors.push(stateError("INVESTIGATION_REPORT_ACCUSED_MISMATCH", `investigationPublicReports[id=${r.id}]: suspectedActorIds 必须等于 incident.initiallyAccusedIds`));
        }
      }

      // 生命周期不变量
      switch (r.status) {
        case "unread":
          if (r.acknowledgedAt) errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=unread 不得有 acknowledgedAt`));
          if (r.linkedInvestigationId) errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=unread 不得有 linkedInvestigationId`));
          break;
        case "acknowledged":
          if (!r.acknowledgedAt) errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=acknowledged 必须有 acknowledgedAt`));
          if (r.linkedInvestigationId) errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=acknowledged 不得有 linkedInvestigationId`));
          break;
        case "investigating":
          if (!r.acknowledgedAt) errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=investigating 必须有 acknowledgedAt`));
          if (!r.linkedInvestigationId) errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=investigating 必须有 linkedInvestigationId`));
          break;
      }

      // 反向链接：case.source.reportId === r.id
      if (r.linkedInvestigationId) {
        const linkedCase = caseById.get(r.linkedInvestigationId);
        if (!linkedCase) {
          errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: linkedInvestigationId="${r.linkedInvestigationId}" 对应 case 不存在`));
        } else {
          if (linkedCase.source.kind !== "investigation_incident") {
            errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: 链接案件 source.kind="${linkedCase.source.kind}"，期望 investigation_incident`));
          }
          if (linkedCase.source.reportId !== r.id) {
            errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: case.source.reportId="${linkedCase.source.reportId}" 与 report.id 不一致`));
          }
          if (linkedCase.source.incidentId !== r.source.incidentId) {
            errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: case.source.incidentId="${linkedCase.source.incidentId}" 与 report.source.incidentId 不一致`));
          }
        }
      }
    } else {
      // ── 进展通报（InvestigationProgressPublicReport，5B-2B2a）─────────
      // 进展报告必须已链接案件（由结算生成）
      if (!r.linkedInvestigationId) {
        errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: 进展通报必须有 linkedInvestigationId`));
      }
      if (r.status === "unread" && r.acknowledgedAt) {
        errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=unread 不得有 acknowledgedAt`));
      }
      if (r.status === "acknowledged" && !r.acknowledgedAt) {
        errors.push(stateError("INVESTIGATION_REPORT_LIFECYCLE", `investigationPublicReports[id=${r.id}]: status=acknowledged 必须有 acknowledgedAt`));
      }
      // 反向链接：linkedCase 存在、来源 investigation_incident、incident 一致
      // （进展报告 id 与 case.source.reportId 不同，故不校验 reportId 相等）
      if (r.linkedInvestigationId) {
        const linkedCase = caseById.get(r.linkedInvestigationId);
        if (!linkedCase) {
          errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: linkedInvestigationId="${r.linkedInvestigationId}" 对应 case 不存在`));
        } else {
          if (linkedCase.source.kind !== "investigation_incident") {
            errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: 链接案件 source.kind="${linkedCase.source.kind}"，期望 investigation_incident`));
          }
          if (linkedCase.source.incidentId !== r.source.incidentId) {
            errors.push(stateError("INVESTIGATION_REPORT_BROKEN_LINK", `investigationPublicReports[id=${r.id}]: case.source.incidentId="${linkedCase.source.incidentId}" 与 report.source.incidentId 不一致`));
          }
        }
      }
    }
  }

  return errors;
}
