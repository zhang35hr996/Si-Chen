import type { GameState } from "../state/types";

export function activeEmpressId(state: GameState): string | null {
  return (
    Object.entries(state.standing).find(
      ([, st]) => st.rank === "huanghou" && st.lifecycle !== "deceased",
    )?.[0] ?? null
  );
}

export function isEmpress(state: GameState, charId: string): boolean {
  return state.standing[charId]?.rank === "huanghou";
}
