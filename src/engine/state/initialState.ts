/**
 * New-game state. In PR 4 the starting values move into content/world.json
 * (data-driven per skeleton-plan §3); until then these defaults are the
 * placeholder starting state: 元年一月上旬, 行动点 6/6.
 */
import { createCalendar, type CalendarStart } from "../calendar/time";
import type { GameState } from "./types";
import { createEmptyJusticeState } from "../justice/types";

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
        healthStatus: "healthy",
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
    taihou: { health: 70, healthStatus: "healthy" },
    flags: {},
    standing: {},
    generatedConsorts: {},
    officials: {},
    officialFamilies: {},
    familyMembers: {},
    kinship: [],
    pendingRetirements: [],
    officialHistory: [],
    officialCandidates: {},
    examinationResults: [],
    annualReviews: [],
    personnelDecisions: {},
    memorials: {},
    memories: {},
    bedchamber: {},
    eventLog: [],
    chronicle: [],
    statusEffects: [],
    haremAdministration: { mode: "empress" },
    justice: createEmptyJusticeState(),
    emotionalConditions: [],
    mentionLog: [],
    eventReactionLog: [],
    sceneHistory: [],
    pendingAftermath: [],
    coldPalaceIncidents: [],
    coldPalaceInterventions: [],
    rngSeed: overrides.rngSeed ?? 1,
  };
}
