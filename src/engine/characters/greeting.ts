/**
 * 请安/游走相关纯函数（设计见 specs/2026-06-21-consort-presence-greeting）。
 * 仅依赖引擎层，无 React/store 引用。
 */
import type { GameState } from "../state/types";
import { fnv1a64Hex } from "../save/canonical";
import type { CharacterContent } from "../content/schemas";
import type { ContentDB } from "../content/loader";
import { presentAt } from "./presence";
import { getGreetingLocation } from "./haremAdministration";
import { isGreetingSlot } from "../calendar/time";

/** 本晨（当前 dayIndex）该侍君是否已被免请安。 */
export function isExcused(state: GameState, charId: string): boolean {
  const e = state.excusedFromGreeting;
  return !!e && e.dayIndex === state.calendar.dayIndex && e.charIds.includes(charId);
}

const OUTGOING_TRAITS = ["活泼", "开朗", "好动", "爱热闹", "天真", "烂漫", "率真", "跳脱", "好奇"];
const RESERVED_TRAITS = ["端肃", "克制", "沉静", "守礼", "重礼", "清冷", "淡泊", "孤僻", "内敛", "寡言", "持重"];

/** 基础游走概率 12，按性格关键词每命中 ±12，clamp [3,40]。 */
export function wanderChance(character: CharacterContent): number {
  const traits = character.profile.personalityTraits ?? [];
  let p = 12;
  for (const t of traits) {
    if (OUTGOING_TRAITS.some((k) => t.includes(k))) p += 12;
    if (RESERVED_TRAITS.some((k) => t.includes(k))) p -= 12;
  }
  return Math.min(40, Math.max(3, p));
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

/**
 * 卯时实际在请安地点的侍君（排除主持请安的受礼者）。
 *
 * 动态地点规则：
 *   - mode === "empress"        → 凤后寝殿（通常坤宁宫）
 *   - mode === "acting_consort" → 协理者寝殿
 *   - mode === "neiwu_proxy"    → null（无正式请安，返回空）
 *
 * 排除逻辑：按受礼者 charId 精确排除，不按住处位置排除，
 * 避免与协理者同宫的其他侍君被误排除。
 */
export function greetingAttendees(db: ContentDB, state: GameState): CharacterContent[] {
  if (!isGreetingSlot(state.calendar)) return [];
  const loc = getGreetingLocation(db, state);
  if (!loc) return []; // neiwu_proxy：暂停正式请安

  const admin = state.haremAdministration;
  // 受礼者 charId：empress 模式下找凤后，acting_consort 模式下为协理者。
  let excludeId: string | null = null;
  if (admin.mode === "acting_consort") {
    excludeId = admin.charId;
  } else if (admin.mode === "empress") {
    for (const [id, st] of Object.entries(state.standing)) {
      if (st.rank === "fenghou" && st.lifecycle !== "deceased") {
        excludeId = id;
        break;
      }
    }
  }

  return presentAt(db, state, loc).filter(
    (c) => c.kind === "consort" && c.id !== excludeId,
  );
}

/** 重新导出 getGreetingLocation 供外部（LocationScreen 等）直接使用。 */
export { getGreetingLocation };
