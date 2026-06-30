/**
 * 上朝 / 侍寝 gating（设计 §8）：皇帝重病 + 太后服丧，任一成立即禁；重病优先显示。
 * 纯函数，UI 与入口逻辑共用。
 */
import type { GameState } from "../engine/state/types";

export type GateResult = { ok: true } | { ok: false; reason: string };

const SOVEREIGN_CRITICAL = "陛下凤体违和，太医请陛下静养。";
const TAIHOU_MOURNING = "国丧期间，上下皆默默守制，不宜行周公之礼。";

function blockReason(state: GameState): string | null {
  if (state.resources.sovereign.healthStatus === "critical") return SOVEREIGN_CRITICAL; // 重病优先
  if (
    state.taihou.deceased === true &&
    state.taihou.mourningUntilDayExclusive !== undefined &&
    state.calendar.dayIndex < state.taihou.mourningUntilDayExclusive
  ) {
    return TAIHOU_MOURNING;
  }
  return null;
}

export function canHoldCourt(state: GameState): GateResult {
  const r = blockReason(state);
  return r ? { ok: false, reason: r } : { ok: true };
}

export function canBedchamber(state: GameState): GateResult {
  const r = blockReason(state);
  return r ? { ok: false, reason: r } : { ok: true };
}
