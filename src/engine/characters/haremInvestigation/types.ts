/**
 * 宫斗调查案件领域类型（Phase 5B-1A + 5B-2）。
 * 玩家知识层：不直接暴露后台 scheme/actor 真相。
 */
import type { GameTime } from "../../calendar/time";
import type { HaremIntrigueKind } from "../haremIntrigue/types";
import type { HaremIntrigueReportConfidence } from "../../state/types";
import type { HeirHealthSymptom, EvidenceDiscoveryAction } from "./truth/types";

export type { EvidenceDiscoveryAction };

/** 可立案的报告种类（排除调查进行中的中间报告）。 */
export type InvestigatableReportKind = "anomaly" | "rumor" | "exposure";

/**
 * 调查案件生命周期状态机。
 *
 *   open ──────────────────────────────────────────────────── cancelled
 *     └─→ in_progress ──── ready_for_review ─┬─ closed_confirmed
 *                └─────────────────────────── └─ closed_unresolved
 */
export type IntrigueInvestigationStatus =
  | "open"
  | "in_progress"
  | "ready_for_review"
  | "closed_unresolved"
  | "closed_confirmed"
  | "cancelled";

/** 是否属于"活跃"案件（未关闭/未取消）。 */
export function isActiveCase(status: IntrigueInvestigationStatus): boolean {
  return status === "open" || status === "in_progress" || status === "ready_for_review";
}

/**
 * 案件来源：以报告和 incident 为桥梁，不直接暴露 schemeId。
 *
 * 判别联合，按事件族区分调查模型（5B-2B）：
 *   - legacy_intrigue：旧宫斗报告，结算读取 haremIncidents.actorId/kind。
 *   - investigation_incident：皇嗣异常等新事件族，结算读取 InvestigationTruth.evidenceNodes。
 * 两个分支均保留 incidentId 字段，旧结算器 `c.source.incidentId` 读取不变。
 */
export type InvestigationCaseSource =
  | { kind: "legacy_intrigue"; reportId: string; incidentId: string }
  | { kind: "investigation_incident"; reportId: string; incidentId: string };

/** @deprecated 5B-2B 起改用 InvestigationCaseSource 判别联合。保留别名以兼容引用。 */
export type IntrigueInvestigationSource = InvestigationCaseSource;

export interface IntrigueInvestigationCase {
  /** "icase_{reportId}" */
  id: string;

  source: InvestigationCaseSource;

  openedAt: GameTime;
  /** 立案时的报告种类（只允许可立案种类）。 */
  openedFromReportKind: InvestigatableReportKind;

  status: IntrigueInvestigationStatus;

  /** 玩家目前确认的受害对象。 */
  knownTargetIds: string[];
  /** 玩家当前怀疑的人；初始复制自 report.suspectedActorIds，不等于后台真实 actor。 */
  suspectIds: string[];
  /** 玩家目前已知的手段；初始复制自 report.suspectedKinds。 */
  suspectedKinds: HaremIntrigueKind[];
  /** 当前调查置信度。 */
  confidence: HaremIntrigueReportConfidence;

  /** 后续调查（5B-2）生成的线索 ID 列表。 */
  leadIds: string[];

  /** 玩家终止或结案时间。 */
  closedAt?: GameTime;
  closureReason?: "player_cancelled" | "insufficient_evidence" | "culprit_confirmed";
  /** 玩家在 closed_confirmed 状态时指认的主谋 ID。 */
  confirmedCulpritId?: string;
}

// ── 5B-2B：皇嗣异常公开报告（玩家可见层） ──────────────────────────────
//
// 由 HeirHealthAnomalyIncident 脱敏生成，是玩家立案的入口。
// 严格知识边界：只携带公开信息（受害皇嗣、症状、公开指控人/被指控者、
// 现场公开事实），绝不包含 causeType / culpritIds / method / motive /
// evidenceNodes 等任何 InvestigationTruth 后台字段。

export type InvestigationPublicReportStatus = "unread" | "acknowledged" | "investigating";

/** 皇嗣异常公开报告（玩家立案入口）。 */
export interface HeirHealthAnomalyPublicReport {
  /** "iarep_{incidentId}" */
  id: string;
  source: { kind: "investigation_incident"; incidentId: string };
  reportKind: "anomaly";
  eventFamily: "heir_health_anomaly";

  createdAt: GameTime;
  status: InvestigationPublicReportStatus;

  knownTargetIds: string[];
  suspectedActorIds: string[];
  confidence: HaremIntrigueReportConfidence;

  symptomCode: HeirHealthSymptom;
  publicFactCodes: string[];
  accuserIds: string[];

  acknowledgedAt?: GameTime;
  linkedInvestigationId?: string;
}

/** 证据驱动调查进展通报（investigation_incident 案件专用）。 */
export interface InvestigationProgressPublicReport {
  id: string;
  source: { kind: "investigation_incident"; incidentId: string };
  reportKind: "investigation_update" | "investigation_final";
  createdAt: GameTime;
  status: "unread" | "acknowledged";
  linkedInvestigationId: string;
  knownTargetIds: string[];
  suspectedActorIds: string[];
  confidence: HaremIntrigueReportConfidence;
  summaryCode: string;
}

/** 调查公开报告（判别联合）。用 reportKind 区分："anomaly" 为异常报告，其余为进展通报。 */
export type InvestigationPublicReport =
  | HeirHealthAnomalyPublicReport
  | InvestigationProgressPublicReport;

/** 任务/线索 ID 格式正则（与 Zod schema 保持同步）。 */
export const TASK_ID_REGEX = /^itask_\d{6}$/;
export const LEAD_ID_REGEX = /^ilead_\d{6}$/;

// ── 5B-2：调查任务 ────────────────────────────────────────────────────

/** 旧宫斗案件（legacy_intrigue）专用方法。 */
export type LegacyInvestigationMethod =
  | "question_target"    // 询问受害者（1 AP，3 天）
  | "question_suspect"   // 传问嫌疑人（1 AP，3 天）
  | "quiet_inquiry";     // 暗中查访（1 AP，6 天）

/** 全部调查方法（legacy + 证据驱动）。 */
export type InvestigationMethod = LegacyInvestigationMethod | EvidenceDiscoveryAction;

export const INVESTIGATION_METHOD_AP: Record<InvestigationMethod, number> = {
  // legacy
  question_target: 1,
  question_suspect: 1,
  quiet_inquiry: 1,
  // evidence-driven
  medical_examination: 1,
  question_servants: 1,
  reconstruct_timeline: 1,
  search_quarters: 1,
  trace_money: 1,
  obtain_testimony: 1,
};

export const INVESTIGATION_METHOD_DAYS: Record<InvestigationMethod, number> = {
  // legacy（保持原值不变）
  question_target: 1,
  question_suspect: 1,
  quiet_inquiry: 2,
  // evidence-driven（1 旬 = 3 durationDays；2 旬 = 6）
  medical_examination: 3,
  question_servants: 3,
  reconstruct_timeline: 3,
  search_quarters: 3,
  trace_money: 6,
  obtain_testimony: 6,
};

export type InvestigationTaskStatus = "pending" | "resolved" | "cancelled";

export interface IntrigueInvestigationTask {
  id: string;
  caseId: string;
  method: InvestigationMethod;

  /** question_suspect / question_target 时的具体对象。 */
  subjectId?: string;

  requestedAt: GameTime;
  dueAt: GameTime;
  status: InvestigationTaskStatus;

  resolvedAt?: GameTime;
  leadId?: string;
}

// ── 5B-2：调查线索 ────────────────────────────────────────────────────

export type InvestigationLeadStrength =
  | "tenuous"
  | "plausible"
  | "strong"
  | "confirmed";

/** 线索强度映射为置信度（两者使用相同枚举值）。 */
export function leadStrengthToConfidence(strength: InvestigationLeadStrength): HaremIntrigueReportConfidence {
  return strength;
}

/**
 * 玩家知识层 claim（来自证据发现，不含 EvidenceClaim 后台字段）。
 * 不携带 culpritIds / misleading / truthId / evidenceNodeId。
 */
export type InvestigationLeadClaim =
  | { kind: "implicates_character"; characterId: string; strength: "weak" | "moderate" | "strong" }
  | { kind: "exonerates_character"; characterId: string; strength: "weak" | "moderate" | "strong" }
  | { kind: "supports_cause"; causeType: string }
  | { kind: "reveals_mechanism"; mechanism: string }
  | { kind: "establishes_fact"; factCode: string };

export interface IntrigueInvestigationLead {
  id: string;
  caseId: string;
  discoveredAt: GameTime;
  method: InvestigationMethod;

  summaryCode: string;
  strength: InvestigationLeadStrength;

  /** 玩家通过本线索开始怀疑的人。 */
  implicatedIds: string[];
  /** 玩家通过本线索基本排除的人。 */
  clearedIds: string[];
  /** 玩家新确认的宫斗手段（legacy 案件用）。 */
  revealedKinds: HaremIntrigueKind[];

  /** 发现此线索的证据节点 ID（investigation_incident 案件专用，防重复发现，不进 presenter）。 */
  sourceEvidenceNodeId?: string;
  /** 结构化玩家知识 claim（investigation_incident 案件专用）。 */
  claims?: InvestigationLeadClaim[];
}
