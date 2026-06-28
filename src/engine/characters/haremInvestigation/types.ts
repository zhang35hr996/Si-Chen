/**
 * 宫斗调查案件领域类型（Phase 5B-1A + 5B-2）。
 * 玩家知识层：不直接暴露后台 scheme/actor 真相。
 */
import type { GameTime } from "../../calendar/time";
import type { HaremIntrigueKind } from "../haremIntrigue/types";
import type { HaremIntrigueReportConfidence } from "../../state/types";

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

/** 案件来源：以报告和 incident 为桥梁，不直接暴露 schemeId。 */
export interface IntrigueInvestigationSource {
  reportId: string;
  incidentId: string;
}

export interface IntrigueInvestigationCase {
  /** "icase_{reportId}" */
  id: string;

  source: IntrigueInvestigationSource;

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

// ── 5B-2：调查任务 ────────────────────────────────────────────────────

export type InvestigationMethod =
  | "question_target"    // 询问受害者（1 AP，1 行动日）
  | "question_suspect"   // 传问嫌疑人（1 AP，1 行动日）
  | "quiet_inquiry";     // 暗中查访（1 AP，2 行动日）

export const INVESTIGATION_METHOD_AP: Record<InvestigationMethod, number> = {
  question_target: 1,
  question_suspect: 1,
  quiet_inquiry: 1,
};

export const INVESTIGATION_METHOD_DAYS: Record<InvestigationMethod, number> = {
  question_target: 1,
  question_suspect: 1,
  quiet_inquiry: 2,
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

  /** 玩家新确认的宫斗手段。 */
  revealedKinds: HaremIntrigueKind[];
}
