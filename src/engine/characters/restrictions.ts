/**
 * 统一行动许可层（任务 §5）。所有「某角色此刻能否参加某玩法」的判断都从这里取，
 * 避免各模块各自散落 isConfined 特判。限制来源：禁足、冷宫、卧病；后续下狱/守丧
 * 可在此追加 reason，而调用方无需改动。
 *
 * 注意：本层只负责「持续状态导致的资格限制」。已故（lifecycle==="deceased"）由各候选
 * 池既有的存活过滤负责，不在此重复。
 */
import type { GameState } from "../state/types";
import { activeConfinement } from "./confinement";
import { activeColdPalaceEffectFor } from "./coldPalace";

/**
 * 受限玩法标识。凡是要求角色离宫、抛头露面、或与皇帝/他人正常往来的行为都在此列；
 * 「奉旨传太医诊治 / 查看资料 / 解除禁足」等例外不在此列（永远允许）。
 */
export type RestrictedActivity =
  | "leave_palace" // 离开自己的宫殿
  | "greeting" // 请安
  | "garden" // 前往御花园
  | "wander" // 随机宫道相遇 / 游走
  | "banquet" // 宫宴 / 宴饮 / 普通宫廷活动
  | "summoned_by_taihou" // 被太后召见 / 训诫
  | "attend_taihou" // 往慈宁宫侍疾
  | "visited_by_consort" // 被其他侍君拜访
  | "visit_others" // 主动拜访他人
  | "bedchamber" // 前往紫宸殿侍寝
  | "normal_summon" // 普通召见 / 翻牌子
  | "normal_visit"; // 皇帝/他人普通进宫聊天送礼

export interface ActionAvailability {
  allowed: boolean;
  reasonCode?: string;
  message?: string;
}

const ALLOWED: ActionAvailability = { allowed: true };

const CONFINED_MESSAGE = "此宫正在禁足，宫门闭锁，未经诏令不得出入。";
const SICK_GREETING_MESSAGE = "此人正在病中，今日免往请安，留在寝殿静养。";

/**
 * 某角色在给定旬能否参与某受限玩法。返回结构化结果（含原因），供 UI 直接展示。
 *
 * 禁足、冷宫封禁全部日常受限玩法；病情仅自动免除请安，不扩大为对召见、看诊等玩法的
 * 一刀切封禁。这样「病中留寝殿休息」与既有传太医/皇帝探视流程可同时成立。
 */
export function getActionAvailability(
  state: GameState,
  charId: string,
  activity: RestrictedActivity,
  turn: number = state.calendar.dayIndex,
): ActionAvailability {
  const confinement = activeConfinement(state, charId, turn);
  if (confinement) {
    return { allowed: false, reasonCode: "confined", message: CONFINED_MESSAGE };
  }
  const coldPalaceEffect = activeColdPalaceEffectFor(state, charId, turn);
  if (coldPalaceEffect) {
    return {
      allowed: false,
      reasonCode: "cold_palace",
      message: "此宫已打入冷宫，不得参与宫廷日常事务。",
    };
  }
  if (activity === "greeting") {
    const healthStatus = state.standing[charId]?.healthStatus ?? "healthy";
    if (healthStatus === "sick" || healthStatus === "critical") {
      return { allowed: false, reasonCode: "ill", message: SICK_GREETING_MESSAGE };
    }
  }
  return ALLOWED;
}

/** 布尔便捷封装：候选池过滤用。 */
export function canCharacterParticipate(
  state: GameState,
  charId: string,
  activity: RestrictedActivity,
  turn: number = state.calendar.dayIndex,
): boolean {
  return getActionAvailability(state, charId, activity, turn).allowed;
}
