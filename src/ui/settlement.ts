/**
 * 时间推进后的全局中断结算（§ post-time-advance settlement）。
 *
 * 解决「换旬/换月后新到期的全局提示需玩家切场景才出现」与「多个到期浮层同时叠加/按 JSX 偶然顺序
 * 渲染」两类缺陷。纯逻辑：确定优先级的中断选择器 + 原子待结算上下文。App 据此：每次成功转旬后登记
 * 一次结算（携带完整返回上下文）→ 同一时刻只呈现一个中断 → 逐个消化（每次读最新状态重选）→ 无中断后
 * 才跑普通 time_advance 事件 → 最终恢复返回上下文一次。
 */
import type { AutoCheckpointRequest } from "./eventReturn";
import type { GameState, HaremIntrigueReport } from "../engine/state/types";
import type { InvestigationProgressPublicReport } from "../engine/characters/haremInvestigation/types";

export type GlobalInterruptKind =
  | "birth" // 到产生产
  | "pregnancy_disclosure" // 敬事房孕事上书（Jingshifang）
  | "successor" // 宗正寺承嗣上书（自孕三月自动）
  | "centennial_heir" // 皇嗣百日赐名
  | "cold_palace_report" // 冷宫事件通报（PUNISH-4C）
  | "harem_intrigue_report" // 宫斗情报（败露/异常）通报（Phase 5A-3b）
  | "harem_discipline" // 后宫内部惩戒御前裁断（PUNISH-4G-B）
  | "harem_admin_review" // 六宫年度例核乘风禀报（PR #76）
  | "grand_selection"; // 大选·殿选日历提示

/** 各全局中断当前是否到期（由 App 从最新 Store + 瞬时驳回态派生；保持纯粹便于测试）。 */
export interface GlobalInterruptInputs {
  birthDue: boolean;
  pregnancyDisclosureDue: boolean;
  successorDue: boolean;
  centennialDue: boolean;
  coldPalaceReportDue: boolean;
  haremIntrigueReportDue: boolean;
  haremDisciplineDue: boolean;
  haremAdminReviewDue: boolean;
  grandSelectionDue: boolean;
}

/**
 * 确定性优先级（皇帝驾崩/终局在结算之前已 short-circuit，不在此列）：
 * 生产 > 孕事上书 > 承嗣 > 百日赐名 > 冷宫通报 > 宫斗情报 > 内部惩戒 > 例核禀报 > 大选。
 * 一次只返回一个；解决后状态变化、重选得到下一个。
 */
export function pickNextGlobalInterrupt(inputs: GlobalInterruptInputs): GlobalInterruptKind | null {
  if (inputs.birthDue) return "birth";
  if (inputs.pregnancyDisclosureDue) return "pregnancy_disclosure";
  if (inputs.successorDue) return "successor";
  if (inputs.centennialDue) return "centennial_heir";
  if (inputs.coldPalaceReportDue) return "cold_palace_report";
  if (inputs.haremIntrigueReportDue) return "harem_intrigue_report";
  if (inputs.haremDisciplineDue) return "harem_discipline";
  if (inputs.haremAdminReviewDue) return "harem_admin_review";
  if (inputs.grandSelectionDue) return "grand_selection";
  return null;
}

/** 最早未读宫斗情报报告（按 createdAt.dayIndex 升序）。 */
export function oldestUnreadIntrigueReport(state: GameState): HaremIntrigueReport | undefined {
  return state.haremIntrigueReports
    .filter((r) => r.status === "unread")
    .sort((a, b) => a.createdAt.dayIndex - b.createdAt.dayIndex || a.id.localeCompare(b.id))[0];
}

/**
 * 统一的最早未读调查报告（5B-2B2a）：同时比较旧宫斗情报与证据案件进展通报，
 * 按 createdAt.dayIndex 升序取最早一条，按 domain 区分由谁消费/acknowledge。
 * 这样证据案件结算后写入 investigationPublicReports 的 unread 进展通报也能进入全局中断流。
 */
export type PendingInvestigationReport =
  | { domain: "legacy_intrigue"; report: HaremIntrigueReport }
  | { domain: "investigation_incident"; report: InvestigationProgressPublicReport };

export function oldestUnreadInvestigationReport(state: GameState): PendingInvestigationReport | undefined {
  type Row = { day: number; id: string; pick: PendingInvestigationReport };
  const rows: Row[] = [];
  for (const r of state.haremIntrigueReports) {
    if (r.status === "unread") {
      rows.push({ day: r.createdAt.dayIndex, id: r.id, pick: { domain: "legacy_intrigue", report: r } });
    }
  }
  for (const r of state.investigationPublicReports) {
    if ((r.reportKind === "investigation_update" || r.reportKind === "investigation_final") && r.status === "unread") {
      rows.push({ day: r.createdAt.dayIndex, id: r.id, pick: { domain: "investigation_incident", report: r } });
    }
  }
  rows.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  return rows[0]?.pick;
}

/** 原子待结算上下文：携带完整 AutoCheckpointRequest（来源 + 完整语义返回目标，原样用于完成）。 */
export type PendingTimeSettlement = { request: AutoCheckpointRequest } | null;

export type TimeSettlementAction =
  | { type: "begin"; request: AutoCheckpointRequest } // 一次成功转旬登记结算（覆盖式）
  | { type: "consume" } // 中断全部消化后，完成结算（跑 time_advance + 恢复）时清空
  | { type: "clear" }; // 新游戏/读档/驾崩清空

export function timeSettlementReducer(
  _state: PendingTimeSettlement,
  action: TimeSettlementAction,
): PendingTimeSettlement {
  switch (action.type) {
    case "begin":
      return { request: action.request };
    case "consume":
    case "clear":
      return null;
  }
}
