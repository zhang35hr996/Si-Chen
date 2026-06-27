/**
 * Unified resolver for consort runtime attributes that may be partially
 * materialised in CharacterStanding (after effects are applied) or fall back
 * to authored hidden values or a safe default.
 *
 * Resolution order for each field:
 *   standing.field  (runtime override — set by adjust_consort_attr effects)
 *   ?? character.hidden?.field  (authored initial value in content JSON)
 *   ?? DEFAULT                  (safe neutral baseline)
 *
 * personality uses the same three-tier order (standing > authored > default).
 * household is runtime-only: standing > DEFAULT (no authored value exists).
 *
 * All callers (funnel, consequence planner, dialogue orchestrator, DebugPanel)
 * MUST go through this function; never read standing.fear directly.
 */
import type { ContentDB } from "../content/loader";
import type { GameState, ConsortPersonality, ConsortHousehold } from "../state/types";

export interface ConsortRuntimeAttrs {
  affection: number;           // 0–100
  fear: number;                // 0–100
  ambition: number;            // 0–100
  loyalty: number;             // 0–100
  personality: ConsortPersonality;
  household: ConsortHousehold;
}

const DEFAULTS = {
  affection: 50,
  fear: 30,
  ambition: 35,
  loyalty: 50,
};

export const PERSONALITY_DEFAULTS: ConsortPersonality = {
  intelligence: 50,
  scheming: 25,
  sociability: 50,
  compassion: 50,
  courage: 40,
  jealousy: 35,
  emotionalStability: 55,
  pride: 45,
};

export const HOUSEHOLD_DEFAULTS: ConsortHousehold = {
  servantOpinion: 50,
  livingStandard: 40,
  privateWealth: 20,
};

export function resolveConsortRuntimeAttrs(
  db: ContentDB,
  state: GameState,
  charId: string,
): ConsortRuntimeAttrs {
  const st = state.standing[charId];
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const h = char?.kind === "consort" ? char.hidden : undefined;

  return {
    affection: st?.affection  ?? h?.affection  ?? DEFAULTS.affection,
    fear:      st?.fear       ?? h?.fear       ?? DEFAULTS.fear,
    ambition:  st?.ambition   ?? h?.ambition   ?? DEFAULTS.ambition,
    loyalty:   st?.loyalty    ?? h?.loyalty    ?? DEFAULTS.loyalty,
    personality: st?.personality ?? h?.personality ?? PERSONALITY_DEFAULTS,
    household:   st?.household   ?? HOUSEHOLD_DEFAULTS,
  };
}
