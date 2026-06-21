/**
 * 请安/游走相关纯函数（设计见 specs/2026-06-21-consort-presence-greeting）。
 * 仅依赖引擎层，无 React/store 引用。
 */
import type { GameState } from "../state/types";

/** 本晨（当前 dayIndex）该侍君是否已被免请安。 */
export function isExcused(state: GameState, charId: string): boolean {
  const e = state.excusedFromGreeting;
  return !!e && e.dayIndex === state.calendar.dayIndex && e.charIds.includes(charId);
}
