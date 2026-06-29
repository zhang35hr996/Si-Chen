/**
 * 宫斗调查案件领域类型（Phase 5B-1A + 5B-2）。
 * 玩家知识层：不直接暴露后台 scheme/actor 真相。
 */
import type { GameTime } from "../../calendar/time";
import type { HaremIntrigueKind } from "../haremIntrigue/types";
import type { HaremIntrigueReportConfidence } from "../../state/types";
import type { HeirHealthSymptom, InvestigationCauseType, IncidentMechanism } from "./truth/types";

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

/** 皇嗣异常立案报告（玩家立案入口）。 */
export interface HeirHealthAnomalyPublicReport {
  /** "iarep_{incidentId}" */
  id: string;
  source: { kind: "investigation_incident"; incidentId: string };
  reportKind: "anomaly";
  eventFamily: "heir_health_anomaly";

  createdAt: GameTime;
  status: InvestigationPublicReportStatus;

  /** 受影响皇嗣（公开已知）。 */
  knownTargetIds: string[];
  /** 公开被指控者（来自 incident.initiallyAccusedIds，非后台真凶）。 */
  suspectedActorIds: string[];
  confidence: HaremIntrigueReportConfidence;

  symptomCode: HeirHealthSymptom;
  publicFactCodes: string[];
  /** 公开指控人（来自 incident.accuserIds）。 */
  accuserIds: string[];

  acknowledgedAt?: GameTime;
  /** 立案后链接的案件 ID，用于幂等立案。 */
  linkedInvestigationId?: string;
}

/**
 * 证据驱动案件的调查进展通报（5B-2B2a）。新案件的 update/final 通报走此处，
 * 绝不塞入旧 `haremIntrigueReports`。只复制案件玩家知识，不含 truth。
 */
export interface InvestigationProgressPublicReport {
  /** "iprog_{taskId}" */
  id: string;
  source: { kind: "investigation_incident"; incidentId: string };
  reportKind: "investigation_update" | "investigation_final";
  createdAt: GameTime;
  status: "unread" | "acknowledged";
  /** 必链接到来源案件。 */
  linkedInvestigationId: string;
  knownTargetIds: string[];
  suspectedActorIds: string[];
  confidence: HaremIntrigueReportConfidence;
  summaryCode: string;
  acknowledgedAt?: GameTime;
}

/**
 * `investigationPublicReports` 元素：按 `reportKind` 判别。
 * `anomaly` = 立案报告（旧存档即此形态，无需迁移）；
 * `investigation_update/final` = 进展通报（5B-2B2a 新增成员）。
 */
export type InvestigationPublicReport =
  | HeirHealthAnomalyPublicReport
  | InvestigationProgressPublicReport;

/** 任务/线索 ID 格式正则（与 Zod schema 保持同步）。 */
export const TASK_ID_REGEX = /^itask_\d{6}$/;
export const LEAD_ID_REGEX = /^ilead_\d{6}$/;

// ── 5B-2：调查任务 ────────────────────────────────────────────────────

export type InvestigationMethod =
  // 旧宫斗（legacy_intrigue）专用
  | "question_target"    // 询问受害者（1 AP，1 行动日）
  | "question_suspect"   // 传问嫌疑人（1 AP，1 行动日）
  | "quiet_inquiry"      // 暗中查访（1 AP，2 行动日）
  // 证据驱动（investigation_incident）专用（5B-2B2a）；
  // 取值与 truth 层 EvidenceDiscoveryAction 一致，便于 node.discoverableBy 匹配
  | "medical_examination"   // 命太医验看（1 AP，1 旬）
  | "question_servants"     // 盘问宫人（1 AP，1 旬）
  | "reconstruct_timeline"  // 重查出入时序（1 AP，1 旬）
  | "search_quarters"       // 搜查住处（1 AP，1 旬）
  | "trace_money"           // 暗查银钱（1 AP，2 旬）
  | "obtain_testimony";     // 深审口供（1 AP，1 旬）

/** 旧宫斗案件（legacy_intrigue）允许的调查方法。 */
export const LEGACY_INVESTIGATION_METHODS: ReadonlySet<InvestigationMethod> = new Set([
  "question_target", "question_suspect", "quiet_inquiry",
]);

/** 证据驱动案件（investigation_incident）允许的调查方法。 */
export const EVIDENCE_INVESTIGATION_METHODS: ReadonlySet<InvestigationMethod> = new Set([
  "medical_examination", "question_servants", "reconstruct_timeline",
  "search_quarters", "trace_money", "obtain_testimony",
]);

export const INVESTIGATION_METHOD_AP: Record<InvestigationMethod, number> = {
  question_target: 1,
  question_suspect: 1,
  quiet_inquiry: 1,
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
  // evidence-driven（dayIndex 本身即旬序号，1 = 一旬）
  medical_examination: 1,
  question_servants: 1,
  reconstruct_timeline: 1,
  search_quarters: 1,
  trace_money: 2,
  obtain_testimony: 2,
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
 * 玩家知识层的线索结论（5B-2B2a）。由证据节点 claim 脱敏而来，
 * 但只表达「玩家如今知道什么」，绝不含 truthId / evidenceNodeId 等后台引用。
 * characterRef 为已解析的角色 ID（公开层）。
 */
export type InvestigationLeadClaim =
  | { kind: "implicates_character"; characterId: string; strength: "weak" | "moderate" | "strong" }
  | { kind: "exonerates_character"; characterId: string; strength: "weak" | "moderate" | "strong" }
  | { kind: "supports_cause"; causeType: InvestigationCauseType }
  | { kind: "reveals_mechanism"; mechanism: IncidentMechanism }
  | { kind: "establishes_fact"; factCode: string };

export interface IntrigueInvestigationLead {
  id: string;
  caseId: string;
  discoveredAt: GameTime;
  method: InvestigationMethod;

  /** UI 使用结构化 code 生成文案（不含后台真相）。 */
  summaryCode: string;

  strength: InvestigationLeadStrength;

  /** 玩家通过本线索开始怀疑的人。 */
  implicatedIds: string[];

  /** 玩家通过本线索基本排除的人。 */
  clearedIds: string[];

  /** 玩家新确认的宫斗手段（旧宫斗案件用；证据案件改用 claims）。 */
  revealedKinds: HaremIntrigueKind[];

  // ── 5B-2B2a 证据驱动扩展（可选；旧存档无此字段，无需迁移）──────────
  /**
   * 本线索来源的隐藏证据节点 ID。仅用于结算去重（推导案件已发现节点集合），
   * 绝不传入 Presenter / LLM。证据驱动案件设置；旧宫斗案件留空。
   */
  sourceEvidenceNodeId?: string;
  /** 结构化结论（证据驱动案件）；脱敏后的玩家知识，可安全展示。 */
  claims?: InvestigationLeadClaim[];
}
