/**
 * 请安/游走相关纯函数（设计见 specs/2026-06-21-consort-presence-greeting）。
 * 仅依赖引擎层，无 React/store 引用。
 */
import type { GameState } from "../state/types";
import { fnv1a64Hex } from "../save/canonical";
import type { CharacterContent } from "../content/schemas";

/** 本晨（当前 dayIndex）该侍君是否已被免请安。 */
export function isExcused(state: GameState, charId: string): boolean {
  const e = state.excusedFromGreeting;
  return !!e && e.dayIndex === state.calendar.dayIndex && e.charIds.includes(charId);
}

const OUTGOING_TRAITS = ["活泼", "开朗", "好动", "爱热闹", "天真", "烂漫", "率真", "跳脱", "好奇"];
const RESERVED_TRAITS = ["端肃", "克制", "沉静", "守礼", "重礼", "清冷", "淡泊", "孤僻", "内敛", "寡言", "持重"];

/** 基础游走概率 25，按性格关键词每命中 ±15，clamp [5,60]。 */
export function wanderChance(character: CharacterContent): number {
  const traits = character.profile.personalityTraits ?? [];
  let p = 25;
  for (const t of traits) {
    if (OUTGOING_TRAITS.some((k) => t.includes(k))) p += 15;
    if (RESERVED_TRAITS.some((k) => t.includes(k))) p -= 15;
  }
  return Math.min(60, Math.max(5, p));
}

/** 确定性游走判定：命中即此 slot 去御花园。 */
export function wanders(
  rngSeed: number,
  dayIndex: number,
  slot: number,
  charId: string,
  chancePercent: number,
): boolean {
  const roll = parseInt(fnv1a64Hex(`${rngSeed}:${dayIndex}:${slot}:wander:${charId}`).slice(0, 8), 16) % 100;
  return roll < chancePercent;
}
