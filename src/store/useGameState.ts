import { useSyncExternalStore } from "react";
import type { GameState } from "../engine/state/types";
import type { GameStore } from "./gameStore";

/** Subscribe a React component to the live GameState. */
export function useGameState(store: GameStore): GameState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
