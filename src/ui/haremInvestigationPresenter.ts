/**
 * 宫斗调查案件展示层（Phase 5B-1B）。
 * 纯函数：只读取 IntrigueInvestigationCase 公开字段，不访问 haremSchemes / haremIncidents。
 *
 * 知识边界：
 *  - 无嫌疑人时显示通用占位文字，不暴露 raw id；
 *  - anomaly 案件嫌疑人列表可能为空（符合玩家知识）；
 *  - 未知角色 ID 显示 "身份不明之人"。
 */
import type {
  IntrigueInvestigationCase,
  IntrigueInvestigationStatus,
  IntrigueInvestigationTask,
  IntrigueInvestigationLead,
} from "../engine/characters/haremInvestigation/types";
import type { HaremIntrigueKind } from "../engine/characters/haremIntrigue/types";
import type { HaremIntrigueReportConfidence } from "../engine/state/types";
import type { AvailableInvestigationAction } from "../engine/characters/haremInvestigation/actions";

export interface HaremInvestigationPresentation {
  /** 案件标题（含嫌疑人/目标/手段语境） */
  title: string;
  /** 立案时间标签 */
  openedAtLabel: string;
  /** 当前状态标签 */
  statusLabel: string;
  /** 已知受影响侍君姓名 */
  targetLabels: string[];
  /** 当前嫌疑人姓名（可能为空） */
  suspectLabels: string[];
  /** 当前已知手段标签 */
  kindLabels: string[];
  /** 置信度标签 */
  confidenceLabel: string;
  /** 无嫌疑人时显示此占位 */
  emptySuspectText: string;
  /** 无已知手段时显示此占位 */
  emptyKindText: string;
}

export const CASE_STATUS_LABELS: Record<IntrigueInvestigationStatus, string> = {
  open: "待查",
  in_progress: "调查中",
  ready_for_review: "待裁定",
  closed_unresolved: "未能查明",
  closed_confirmed: "已经查明",
  cancelled: "已终止",
};

const KIND_LABELS: Record<HaremIntrigueKind, string> = {
  slander: "散布谣言",
  false_accusation: "诬告陷害",
  steal_credit: "窃取功劳",
  faction_pressure: "结党施压",
  servant_subversion: "收买仆从",
};

const CONFIDENCE_LABELS: Record<HaremIntrigueReportConfidence, string> = {
  tenuous: "线索模糊",
  plausible: "略有眉目",
  strong: "线索较明",
  confirmed: "已有确证",
};

const PERIOD_LABELS: Record<string, string> = {
  early: "上旬",
  mid: "中旬",
  late: "下旬",
};

function openedAtLabel(c: IntrigueInvestigationCase): string {
  const { year, month, period } = c.openedAt;
  const yearStr = year === 1 ? "元年" : `${year}年`;
  return `${yearStr}${month}月${PERIOD_LABELS[period] ?? ""}`;
}

function caseTitle(
  c: IntrigueInvestigationCase,
  resolveCharacterName: (id: string) => string,
): string {
  const firstTarget = c.knownTargetIds[0];
  const targetName = firstTarget ? resolveCharacterName(firstTarget) : undefined;
  const firstSuspect = c.suspectIds[0];
  const suspectName = firstSuspect ? resolveCharacterName(firstSuspect) : undefined;
  const firstKind = c.suspectedKinds[0];
  const kindLabel = firstKind ? (KIND_LABELS[firstKind] ?? firstKind) : undefined;

  if (suspectName && targetName) {
    return `${suspectName}涉嫌${kindLabel ? kindLabel : "构陷"}${targetName}案`;
  }
  if (targetName) {
    return `${targetName}处异常`;
  }
  return "宫中异常案";
}

export function presentHaremInvestigationCase(
  investigationCase: IntrigueInvestigationCase,
  resolveCharacterName: (id: string) => string,
): HaremInvestigationPresentation {
  return {
    title: caseTitle(investigationCase, resolveCharacterName),
    openedAtLabel: openedAtLabel(investigationCase),
    statusLabel: CASE_STATUS_LABELS[investigationCase.status],
    targetLabels: investigationCase.knownTargetIds.map(resolveCharacterName),
    suspectLabels: investigationCase.suspectIds.map(resolveCharacterName),
    kindLabels: investigationCase.suspectedKinds.map((k) => KIND_LABELS[k] ?? k),
    confidenceLabel: CONFIDENCE_LABELS[investigationCase.confidence] ?? investigationCase.confidence,
    emptySuspectText: "目前尚无明确嫌疑人",
    emptyKindText: "作案手段尚未查明",
  };
}

// ── 详情视图（含任务 / 线索 / 可用行动）────────────────────────────────

export interface InvestigationCurrentTaskView {
  methodLabel: string;
  subjectLabel?: string;
  requestedAtLabel: string;
  dueAtLabel: string;
}

export interface InvestigationLeadView {
  id: string;
  discoveredAtLabel: string;
  methodLabel: string;
  summary: string;
  strengthLabel: string;
}

export interface InvestigationDetailPresentation extends HaremInvestigationPresentation {
  currentTask?: InvestigationCurrentTaskView;
  leadViews: InvestigationLeadView[];
  availableActions: AvailableInvestigationAction[];
  confirmedCulpritLabel?: string;
  /** 当前嫌疑人 {id, label} 列表，供 ready_for_review 裁定选人使用。 */
  suspectViews: Array<{ id: string; label: string }>;
}

const METHOD_LABELS: Record<string, string> = {
  question_target: "询问受害者",
  question_suspect: "传问嫌疑人",
  quiet_inquiry: "暗中查访",
};

const LEAD_STRENGTH_LABELS: Record<string, string> = {
  tenuous: "模糊线索",
  plausible: "有效线索",
  strong: "有力证据",
  confirmed: "确凿证据",
};

const LEAD_SUMMARY_LABELS: Record<string, string> = {
  inquiry_limited_findings: "查访所得有限，线索仍不充分",
  inquiry_found_suspicious_pattern: "发现可疑规律，需进一步核实",
  suspect_inconclusive_account: "供述存在漏洞，尚无定论",
  suspect_contradicted_account: "供词与证据相悖，嫌疑加深",
  target_account_consistent: "受害者陈述有所补充",
  orphan_task_skipped: "（调查记录缺失）",
};

function gameTimeLabel(gt: { year: number; month: number; period: string }): string {
  const yearStr = gt.year === 1 ? "元年" : `${gt.year}年`;
  return `${yearStr}${gt.month}月${PERIOD_LABELS[gt.period] ?? ""}`;
}

export function presentHaremInvestigationDetail(
  investigationCase: IntrigueInvestigationCase,
  tasks: IntrigueInvestigationTask[],
  leads: IntrigueInvestigationLead[],
  availableActions: AvailableInvestigationAction[],
  resolveCharacterName: (id: string) => string,
): InvestigationDetailPresentation {
  const base = presentHaremInvestigationCase(investigationCase, resolveCharacterName);

  const pendingTask = tasks.find((t) => t.caseId === investigationCase.id && t.status === "pending");
  const currentTask: InvestigationCurrentTaskView | undefined = pendingTask
    ? {
        methodLabel: METHOD_LABELS[pendingTask.method] ?? pendingTask.method,
        subjectLabel: pendingTask.subjectId ? resolveCharacterName(pendingTask.subjectId) : undefined,
        requestedAtLabel: gameTimeLabel(pendingTask.requestedAt),
        dueAtLabel: gameTimeLabel(pendingTask.dueAt),
      }
    : undefined;

  const caseLeads = leads
    .filter((l) => investigationCase.leadIds.includes(l.id))
    .sort((a, b) => a.discoveredAt.dayIndex - b.discoveredAt.dayIndex);

  const leadViews: InvestigationLeadView[] = caseLeads.map((l) => ({
    id: l.id,
    discoveredAtLabel: gameTimeLabel(l.discoveredAt),
    methodLabel: METHOD_LABELS[l.method] ?? l.method,
    summary: LEAD_SUMMARY_LABELS[l.summaryCode] ?? l.summaryCode,
    strengthLabel: LEAD_STRENGTH_LABELS[l.strength] ?? l.strength,
  }));

  const confirmedCulpritLabel =
    investigationCase.confirmedCulpritId
      ? resolveCharacterName(investigationCase.confirmedCulpritId)
      : undefined;

  const suspectViews = investigationCase.suspectIds.map((id) => ({
    id,
    label: resolveCharacterName(id),
  }));

  return {
    ...base,
    currentTask,
    leadViews,
    availableActions,
    confirmedCulpritLabel,
    suspectViews,
  };
}
