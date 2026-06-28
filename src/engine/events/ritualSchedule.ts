/**
 * 年度礼仪事件生产器（当前：万寿节）。
 *
 * 规则：
 *   每年八月上旬（month=8, period="early"）起，若当年尚未安排，
 *   置 ritual_birthday_pending=true 并写年度 guard flag，保证幂等。
 *
 * catch-up 语义：calendar.month >= 8 && 上旬已过（dayIndex 到达），所以使用
 *   calendar.dayIndex >= dueIndex（不是精确等于），存档跳旬同样触发。
 *
 * 调用点：settlePostAdvance 中，各月度/年度任务块之后。
 */
import { dayIndexOf } from "../calendar/time";
import type { GameState } from "../state/types";

const BIRTHDAY_MONTH = 8;
const BIRTHDAY_PERIOD = "early" as const;

function birthdayDueIndex(year: number): number {
  return dayIndexOf(year, BIRTHDAY_MONTH, BIRTHDAY_PERIOD);
}

function scheduledKey(year: number): string {
  return `ritual_birthday_scheduled_${year}`;
}

/**
 * 若当年万寿节筹办窗口已到达且尚未安排，设置 pending flag 并写年度幂等 guard。
 * 纯函数：返回新 state（或原 state 引用，若无变化）。
 */
export function maybeScheduleBirthdayRitual(state: GameState): GameState {
  const { year, dayIndex } = state.calendar;
  const due = birthdayDueIndex(year);
  if (dayIndex < due) return state;

  const key = scheduledKey(year);
  if (state.flags[key]) return state;

  return {
    ...state,
    flags: {
      ...state.flags,
      ritual_birthday_pending: true,
      [key]: true,
    },
  };
}
