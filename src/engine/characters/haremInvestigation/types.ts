/**
 * 宫斗调查案件领域类型（Phase 5B-1A）。
 * 玩家知识层：不直接暴露后台 scheme/actor 真相。
 */
import type { GameTime } from "../../calendar/time";
import type { HaremIntrigueKind } from "../haremIntrigue/types";
import type { HaremIntrigueReportConfidence, HaremIntrigueReportKind } from "../../state/types";

/**
 * 调查案件生命周期状态机。
 *
 * 5B-1 只实际使用 open / cancelled；其余状态供 5B-2/5B-3 扩展。
 *
 *   open ──────────────────────────────────────────────────── cancelled
 *     └─→ in_progress ──── ready_for_review ─┬─ closed_confirmed
 *                                             └─ closed_unresolved
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
  /** 立案时的报告种类（exposure / anomaly）。 */
  openedFromReportKind: HaremIntrigueReportKind;

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
}
