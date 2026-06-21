/** 情绪状态写入：append-only，按 owner 单调 id。 */
import type { EmotionalCondition, GameState } from "../state/types";

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
