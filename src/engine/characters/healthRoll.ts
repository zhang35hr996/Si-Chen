/**
 * 健康系统专用确定性随机（独立于 gestationRoll 命名空间）。
 * fnv1a64Hex 取模，读档重算结果不变。seedKey 应含 rngSeed + 时间 + 角色 + 用途。
 */
import { fnv1a64Hex } from "../save/canonical";

/** 0–99。 */
export function healthRoll(seedKey: string): number {
  return parseInt(fnv1a64Hex(`health:${seedKey}`).slice(0, 12), 16) % 100;
}

/** 含端点 [lo, hi]（lo ≤ hi）。 */
export function healthRollRange(seedKey: string, lo: number, hi: number): number {
  const span = hi - lo + 1;
  return lo + (parseInt(fnv1a64Hex(`health:${seedKey}`).slice(0, 12), 16) % span);
}
