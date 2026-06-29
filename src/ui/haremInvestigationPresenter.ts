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
import type { InvestigationMethod } from "../engine/characters/haremInvestigation/types";
import type { EvidenceCaseAssessment } from "../engine/characters/haremInvestigation/assessEvidenceDrivenCase";

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
  closed_explained: "并非人为加害",
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

export interface AvailableActionView {
  method: InvestigationMethod;
  label: string;
  apCost: number;
  durationDays: number;
  subjects?: Array<{ id: string; label: string }>;
}

export interface InvestigationDetailPresentation extends HaremInvestigationPresentation {
  currentTask?: InvestigationCurrentTaskView;
  leadViews: InvestigationLeadView[];
  availableActionViews: AvailableActionView[];
  confirmedCulpritLabel?: string;
  /** 当前嫌疑人 {id, label} 列表，供 ready_for_review 裁定选人使用。 */
  suspectViews: Array<{ id: string; label: string }>;
  /** 是否允许确认主谋（旧宫斗案件：confidence===confirmed；证据案件见 verdictOptions）。 */
  canConfirmCulprit: boolean;
  /**
   * 证据驱动案件的裁定选项（5B-2B2b）。由 assessment 派生：
   * 只把 assessment 判定可确认的人放入 confirmableSuspects（非全部 suspectIds）。
   */
  verdictOptions: {
    canConfirmCulprit: boolean;
    confirmableSuspects: Array<{ id: string; label: string }>;
    canConfirmBenignCause: boolean;
    benignCauseLabel?: string;
  };
}

const METHOD_LABELS: Record<InvestigationMethod, string> = {
  // legacy
  question_target: "询问受害者",
  question_suspect: "传问嫌疑人",
  quiet_inquiry: "暗中查访",
  // evidence-driven
  medical_examination: "查验脉案与药物",
  question_servants: "询问宫人",
  reconstruct_timeline: "重查事发时序",
  trace_money: "追查钱物流向",
  search_quarters: "搜查相关住处",
  obtain_testimony: "获取关键证词",
};

const LEAD_STRENGTH_LABELS: Record<string, string> = {
  tenuous: "模糊线索",
  plausible: "有效线索",
  strong: "有力证据",
  confirmed: "确凿证据",
};

const LEAD_SUMMARY_LABELS: Record<string, string> = {
  // question_target
  target_mentioned_unusual: "受影响之人提及近来有异常情形",
  target_noted_prior_activity: "受影响之人回忆起事前的可疑举动",
  // question_suspect — true actor
  suspect_admitted_under_pressure: "当事人受审时有所失口，嫌疑加重",
  suspect_contradicted_account: "供词与证据相悖，嫌疑明显加深",
  suspect_evasive_response: "当事人回避追问，态度可疑",
  suspect_denied_convincingly: "当事人坦然应对，暂无实证",
  // question_suspect — non-actor
  suspect_cleared_alibi: "当事人提供可信不在场证明，基本排除",
  suspect_irrelevant_account: "当事人所述与案情无关",
  suspect_inconclusive_account: "供述存在漏洞，尚无定论",
  // quiet_inquiry
  inquiry_gathered_servant_rumors: "查访所得有限，仅有零散传闻",
  inquiry_tracked_actor_movement: "追踪到可疑人员的行踪脉络",
  inquiry_found_suspicious_pattern: "发现可疑规律，需进一步核实",
  inquiry_revealed_scheme_method: "查访揭示了作案手段的部分情况",
  inquiry_limited_findings: "暗中查访所得有限，线索仍不充分",
  // 5B-2B2a/b 证据驱动线索（evidence_{factCode} 结构化文案）
  investigation_no_new_evidence: "查访一番，未获新证",
  evidence_diagnosis_matches_old_illness: "太医复核脉案，症候与旧疾相合",
  evidence_drug_residue_normal: "所用药物残留未见异常",
  evidence_timeline_precedes_suspect_arrival: "病症发作早于被疑之人到场",
  evidence_no_outside_contact_path: "查无外人接触的可能路径",
  evidence_dosage_mismatch_prescription: "所进汤药与医嘱剂量不符",
  evidence_missing_decoction_record: "煎药记档有缺失",
  evidence_inconsistent_servant_testimony: "宫人供词前后不一",
  evidence_abnormal_drug_residue: "查得药中残留异常",
  evidence_unexplained_payment_to_servant: "查得一笔来历不明的银钱往来",
  evidence_suspect_contact_with_servant: "查得被疑之人与宫人私下往来",
  evidence_servant_final_confession: "宫人最终供认实情",
  evidence_surface_evidence_points_to_framed_person: "表面证据直指某人，似有蹊跷",
  evidence_medicine_left_unattended: "汤药曾无人看管",
  evidence_framers_servant_near_scene: "有可疑宫人曾在近旁出没",
  evidence_suspicious_money_or_letter: "查得可疑银钱或书信",
  evidence_illness_not_man_made: "查明病症并非人为所致",
  evidence_timeline_conflict_in_accusation: "指控与时序相互矛盾",
  evidence_servants_pressured_unified_testimony: "宫人口供似受人胁迫而趋一致",
  evidence_accuser_has_old_grievance: "指控之人与被指者素有旧怨",
  // misc
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
  /** 证据案件的后台评估（5B-2B2b）；旧宫斗案件传 undefined。 */
  assessment?: EvidenceCaseAssessment,
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
    summary: LEAD_SUMMARY_LABELS[l.summaryCode] ?? "调查取得了一项新线索，详情尚待核实",
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

  const availableActionViews: AvailableActionView[] = availableActions.map((a) => ({
    method: a.method,
    label: METHOD_LABELS[a.method] ?? a.method,
    apCost: a.apCost,
    durationDays: a.durationDays,
    subjects: a.subjectCandidateIds?.map((id) => ({ id, label: resolveCharacterName(id) })),
  }));

  const isEvidenceCase = investigationCase.source.kind === "investigation_incident";

  // 旧宫斗案件保留原行为；证据案件的确认主谋以 assessment 为准（见 verdictOptions）
  const canConfirmCulprit = !isEvidenceCase
    ? investigationCase.status === "ready_for_review" && investigationCase.confidence === "confirmed"
    : assessment?.kind === "culprit_ready";

  const verdictOptions = isEvidenceCase
    ? {
        canConfirmCulprit: assessment?.kind === "culprit_ready",
        confirmableSuspects:
          assessment?.kind === "culprit_ready"
            ? assessment.confirmableCulpritIds.map((id) => ({ id, label: resolveCharacterName(id) }))
            : [],
        canConfirmBenignCause: assessment?.kind === "benign_ready",
        benignCauseLabel: assessment?.kind === "benign_ready" ? "皇嗣自身旧疾发作" : undefined,
      }
    : {
        // 旧宫斗案件：沿用 confidence 门控、可指认任一在册嫌疑人，无自然病因出口
        canConfirmCulprit,
        confirmableSuspects: suspectViews,
        canConfirmBenignCause: false,
      };

  return {
    ...base,
    currentTask,
    leadViews,
    availableActionViews,
    confirmedCulpritLabel,
    suspectViews,
    canConfirmCulprit,
    verdictOptions,
  };
}
