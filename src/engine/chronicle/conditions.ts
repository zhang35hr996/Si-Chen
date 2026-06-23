/** 情绪状态写入：append-only，按 owner 单调 id。 */
import type { GameTime } from "../calendar/time";
import type { EmotionalCondition, GameState } from "../state/types";

/**
 * Half-lives by recovery profile, in action-day (dayIndex) periods — 3 per month,
 * 36 per year. "stuck" never decays. Calibratable; chosen so acute states fade
 * within months and slow ones over years (PR-A item 8).
 */
const CONDITION_HALF_LIFE: Record<Exclude<EmotionalCondition["recoveryProfile"], "stuck">, number> = {
  fast: 9,     // ≈ 3 months
  normal: 36,  // ≈ 1 year
  slow: 108,   // ≈ 3 years
};

/**
 * Current severity of an emotional condition, decayed from its starting severity
 * by elapsed action-days. A `stuck` condition holds at its starting severity;
 * the others halve every CONDITION_HALF_LIFE periods. Result is clamped to
 * [0, startingSeverity] and never grows.
 *
 * This replaces the old "any matching condition = permanent full bonus" behavior:
 * an `acute_grief` no longer pins its source memory at the top of recall years later.
 */
export function effectiveConditionSeverity(condition: EmotionalCondition, now: GameTime): number {
  if (condition.recoveryProfile === "stuck") return condition.severity;
  const age = Math.max(0, now.dayIndex - condition.startedAt.dayIndex);
  const halfLife = CONDITION_HALF_LIFE[condition.recoveryProfile];
  const decayed = condition.severity * Math.pow(0.5, age / halfLife);
  return Math.min(condition.severity, Math.max(0, decayed));
}

export function conditionId(ownerId: string, seq: number): string {
  return `cond_${ownerId}_${String(seq).padStart(6, "0")}`;
}

export function appendCondition(state: GameState, draft: Omit<EmotionalCondition, "id">): GameState {
  const re = new RegExp(`^cond_${draft.ownerId}_(\\d{6})$`);
  let max = 0;
  for (const c of state.emotionalConditions) {
    const m = re.exec(c.id);
    if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  const cond: EmotionalCondition = { id: conditionId(draft.ownerId, max + 1), ...draft };
  return { ...state, emotionalConditions: [...state.emotionalConditions, cond] };
}
