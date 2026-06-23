/**
 * 孕情展示纯格式化（display-only）。唯一权威来源：state.resources.bloodline.gestations + 引擎 gestationMonth
 * （受孕月=1）。不新增持久字段、不在组件里复制月份算术、不从 lifecycle/天数/recoverUntilMonth/侍寝记录/
 * PregnancyState.status 推断孕月。carrier 精确匹配（"sovereign" / charId）。
 */
import { gestationMonth } from "../../engine/characters/gestation";
import type { GameState, GestationState } from "../../engine/state/types";

export interface GestationDisplay {
  /** 当前孕月（受孕月=1）；仅当胎息存在且月份 ≥1 才有值，否则 null（退化态不臆造月份）。 */
  month: number | null;
  label: string;
}

/** 月份守卫：仅挡 <1 的非法值，其余直接用引擎结果（绝不手动钳到 10）。 */
function validMonth(state: GameState, gestation: GestationState): number | null {
  const m = gestationMonth(state.calendar, gestation.conceivedAt);
  return m >= 1 ? m : null;
}

/** 帝王孕情：仅由 carrier==="sovereign" 的活跃胎息派生（pending 披露前态绝不在此显示）。 */
export function sovereignGestationDisplay(state: GameState): GestationDisplay | null {
  const g = state.resources.bloodline.gestations.find((x) => x.carrier === "sovereign");
  if (!g) return null;
  const month = validMonth(state, g);
  return { month, label: month !== null ? `怀胎 · 孕${month}月` : "怀胎" };
}

/** 侍君孕情：carrier===charId 的活跃胎息 → 「承嗣君 · 孕N月」；无胎息但 lifecycle==="carrying"（迁移残态）→ 退化「怀胎」（无月）；否则 null。 */
export function consortGestationDisplay(state: GameState, charId: string): GestationDisplay | null {
  const g = state.resources.bloodline.gestations.find((x) => x.carrier === charId);
  if (g) {
    const month = validMonth(state, g);
    return { month, label: month !== null ? `承嗣君 · 孕${month}月` : "承嗣君" };
  }
  if (state.standing[charId]?.lifecycle === "carrying") return { month: null, label: "怀胎" };
  return null;
}
