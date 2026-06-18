/**
 * 确定性受孕判定：不引入随机种子变更，由 (rngSeed, 行动日序, 侍君) 哈希取模。
 * 同输入同结果 ⇒ 存档/重放稳定。仅激情侍寝调用、仅在未孕时调用（调用方负责）。
 */
import { fnv1a64Hex } from "../save/canonical";

export function conceives(rngSeed: number, dayIndex: number, charId: string, chancePercent: number): boolean {
  if (chancePercent <= 0) return false;
  if (chancePercent >= 100) return true;
  const roll = parseInt(fnv1a64Hex(`${rngSeed}:${dayIndex}:${charId}`).slice(0, 8), 16) % 100;
  return roll < chancePercent;
}
