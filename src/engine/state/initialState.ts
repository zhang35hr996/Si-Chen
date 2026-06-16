/**
 * New-game state. In PR 4 the starting values move into content/world.json
 * (data-driven per skeleton-plan §3); until then these defaults are the
 * placeholder starting state: 元年一月上旬, 行动点 6/6.
 */
import { createCalendar, type CalendarStart } from "../calendar/time";
import type { GameState } from "./types";

export interface InitialStateOverrides {
  calendar?: CalendarStart;
  playerLocation?: string;
  rngSeed?: number;
}

export function createInitialState(overrides: InitialStateOverrides = {}): GameState {
  return {
    calendar: createCalendar(overrides.calendar),
    playerLocation: overrides.playerLocation ?? "",
    resources: {
      court: { authority: 50, publicSupport: 50, factionPressure: 20 },
      harem: { harmony: 60, jealousy: 20 },
      bloodline: {
        legitimacy: 60,
        menstrualStatus: "normal",
        pregnancy: { status: "none", candidateIds: [] },
        heirs: [],
      },
    },
    flags: {},
    relationships: {},
    standing: {},
    memories: {},
    bedchamber: {},
    eventLog: [],
    sceneHistory: [],
    rngSeed: overrides.rngSeed ?? 1,
  };
}
