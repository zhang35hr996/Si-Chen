/**
 * 时间推进后的全局中断结算（§ post-time-advance settlement）。
 *
 * 解决「换旬/换月后新到期的全局提示需玩家切场景才出现」与「多个到期浮层同时叠加/按 JSX 偶然顺序
 * 渲染」两类缺陷。纯逻辑：确定优先级的中断选择器 + 原子待结算上下文。App 据此：每次成功转旬后登记
 * 一次结算（携带完整返回上下文）→ 同一时刻只呈现一个中断 → 逐个消化（每次读最新状态重选）→ 无中断后
 * 才跑普通 time_advance 事件 → 最终恢复返回上下文一次。
 */
import type { AutoCheckpointRequest } from "./eventReturn";

export type GlobalInterruptKind =
  | "birth" // 到产生产
  | "pregnancy_disclosure" // 敬事房孕事上书（Jingshifang）
  | "successor" // 宗正寺承嗣上书（自孕三月自动）
  | "centennial_heir" // 皇嗣百日赐名
  | "grand_selection"; // 大选·殿选日历提示

/** 各全局中断当前是否到期（由 App 从最新 Store + 瞬时驳回态派生；保持纯粹便于测试）。 */
export interface GlobalInterruptInputs {
  birthDue: boolean;
  pregnancyDisclosureDue: boolean;
  successorDue: boolean;
  centennialDue: boolean;
  grandSelectionDue: boolean;
}

/**
 * 确定性优先级（皇帝驾崩/终局在结算之前已 short-circuit，不在此列）：
 * 生产 > 孕事上书 > 承嗣 > 百日赐名 > 大选。一次只返回一个；解决后状态变化、重选得到下一个。
 */
export function pickNextGlobalInterrupt(inputs: GlobalInterruptInputs): GlobalInterruptKind | null {
  if (inputs.birthDue) return "birth";
  if (inputs.pregnancyDisclosureDue) return "pregnancy_disclosure";
  if (inputs.successorDue) return "successor";
  if (inputs.centennialDue) return "centennial_heir";
  if (inputs.grandSelectionDue) return "grand_selection";
  return null;
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
