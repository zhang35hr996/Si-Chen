import type { GameState } from "../state/types";

/** 改某官员的官职（→品级→权势派生跟随）。返回新 state；未知 id/post 时原样返回。 */
export function changeOfficialGrade(state: GameState, officialId: string, newPostId: string): GameState {
  const cur = state.officials[officialId];
  if (!cur) return state;
  return {
    ...state,
    officials: { ...state.officials, [officialId]: { ...cur, postId: newPostId } },
  };
}
