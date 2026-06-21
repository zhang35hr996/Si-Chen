/** 有效强度（spec：strength 牢固度 与 activation 分离）。permanent 不衰减；其余按 retention 半衰。 */
import { memoryAgeDays } from "../memory/inspect";
import type { GameTime } from "../calendar/time";
import type { MemoryEntry } from "../state/types";

export const MEMORY_CONFIG = {
  // 单位：dayIndex 行动日周期（每月 3）— 非日历天；数值校准实现期可调
  halfLifeDays: { fast: 75, slow: 720 },
  minimumRetrievalSalience: 25,
} as const;

export function effectiveStrength(entry: MemoryEntry, now: GameTime): number {
  if (entry.retention === "permanent") return entry.strength;
  const halfLife = MEMORY_CONFIG.halfLifeDays[entry.retention];
  const age = memoryAgeDays(entry, now); // 行动日差（dayIndex）
  const decayed = entry.strength * Math.pow(0.5, age / halfLife);
  return Math.min(100, Math.max(0, decayed));
}
