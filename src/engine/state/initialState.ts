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
      sovereign: {
        health: 70,
        diligence: 50,
        prestige: 50,
        martial: 50,
        statecraft: 50,
        cruelty: 20,
        fatigue: 20,
        regimeSecurity: 60,
      },
      nation: {
        military: 50,
        treasury: 10000,
        publicSupport: 50,
        productivity: 50,
        governance: 50,
        consortClanPower: 30,
        ministerLoyalty: 50,
        corruption: 20,
        clanDiscontent: 20,
        rumor: 10,
      },
      bloodline: {
        menstrualStatus: "normal",
        pregnancy: { status: "none", candidateIds: [] },
        gestations: [],
        heirs: [],
      },
      storehouse: { items: {} },
    },
    taihou: { ill: false },
    flags: {},
    standing: {},
    generatedConsorts: {},
    officials: {},
    memories: {},
    bedchamber: {},
    eventLog: [],
    chronicle: [],
    emotionalConditions: [],
    mentionLog: [],
    sceneHistory: [],
    rngSeed: overrides.rngSeed ?? 1,
  };
}
