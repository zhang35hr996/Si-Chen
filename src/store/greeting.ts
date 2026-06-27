/** 免请安/留宿的状态装配（纯函数；GameStore 负责 set+emit）。 */
import { getCharacterLocation } from "../engine/characters/presence";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";

const EXCUSE_AFFECTION = 3;
const EXCUSE_FAVOR = 2;
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/** 施恩免请安：favor+2、affection+3，记入当日 excused，清留宿。 */
export function excuseFromGreeting(state: GameState, db: ContentDB, charId: string): GameState {
  const st = state.standing[charId];
  if (!st) return state;
  const baseAff = st.affection ?? db.characters[charId]?.hidden?.affection ?? 0;
  const di = state.calendar.dayIndex;
  const prev =
    state.excusedFromGreeting && state.excusedFromGreeting.dayIndex === di
      ? state.excusedFromGreeting.charIds
      : [];
  return {
    ...state,
    standing: {
      ...state.standing,
      [charId]: { ...st, favor: clampPct(st.favor + EXCUSE_FAVOR), peakFavor: Math.max(st.peakFavor, clampPct(st.favor + EXCUSE_FAVOR)), affection: clampPct(baseAff + EXCUSE_AFFECTION) },
    },
    excusedFromGreeting: { dayIndex: di, charIds: [...new Set([...prev, charId])] },
    overnightWith: undefined,
  };
}

/** 「不说」分支：仅清留宿，侍君照常请安。 */
export function dismissOvernight(state: GameState): GameState {
  return { ...state, overnightWith: undefined };
}

/** 子时侍寝/对话滚旬后调用：仅当确已滚旬且玩家就在该侍君住处时记留宿。 */
export function recordOvernight(state: GameState, db: ContentDB, charId: string, rolledOver: boolean): GameState {
  if (!rolledOver) return state;
  if (getCharacterLocation(db, state, charId) !== state.playerLocation) return state;
  return { ...state, overnightWith: { charId, morningDayIndex: state.calendar.dayIndex } };
}
