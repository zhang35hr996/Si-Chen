/**
 * 知情资格（spec 第 3 类）：谁「默认知道」一条 CourtEvent。
 * 不为每人复制记忆——palace/realm 走规则，circle 走白名单。
 * v1：realm 必为 institutional（schema 已保证）；不含 rumor/certainty。
 *
 * 两条时间闸必须在 scope 分支【之前】：否则未来入宫者经 circle/realm 仍偷知，
 * 且谁都能「预知」尚未发生的事件。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import { isCurrentlyPresent, characterEntryTime } from "./presence";
import type { CourtEvent, GameState } from "../state/types";

export function canKnowEvent(state: GameState, charId: string, event: CourtEvent): boolean {
  // 闸1：不存在 / 已逝 / 尚未入场 → 一律不知情（isCurrentlyPresent 三者皆拦）
  if (!isCurrentlyPresent(state, charId)) return false;
  const now = toGameTime(state.calendar);
  // 闸2：编年史只载已发生；未来事件谁都不知道
  if (compareGameTime(event.occurredAt, now) > 0) return false;

  const p = event.publicity;
  if (p.scope === "circle") return p.circleIds.includes(charId);
  if (p.scope === "realm") return true;
  // palace：须有入场时刻（官员无 → 宫内事不在可知范围）
  const entry = characterEntryTime(state, charId);
  if (!entry) return false;
  return p.persistence === "institutional" || compareGameTime(entry, event.occurredAt) <= 0;
}
