/**
 * Typed commands — the only way GameState changes (skeleton-plan §6 funnel).
 * PR 2 ships the state/calendar commands; effect-funnel commands
 * (relationship/favor/resource/memory) arrive with their owning PRs.
 */
import type { FlagValue } from "./types";

export type GameCommand =
  | { type: "SPEND_AP"; amount: number }
  /** 独自休息：弃当旬剩余行动点，直接进入下一旬（次旬早上）。 */
  | { type: "SKIP_REMAINDER" }
  | { type: "MOVE_TO_LOCATION"; locationId: string }
  | { type: "SET_FLAG"; key: string; value: FlagValue };

export interface ApplyOutcome<S> {
  state: S;
  /** True if any applied command rolled the action-day (time_advance checkpoint fires later, PR 7). */
  rolledOver: boolean;
}
