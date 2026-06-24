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
 * All callers (funnel, consequence planner, dialogue orchestrator, DebugPanel)
 * MUST go through this function; never read standing.fear directly.
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";

export interface ConsortRuntimeAttrs {
  affection: number; // 0–100
  fear: number;      // 0–100
  ambition: number;  // 0–100
  loyalty: number;   // 0–100
}

const DEFAULTS: ConsortRuntimeAttrs = {
  affection: 50,
  fear: 30,
  ambition: 35,
  loyalty: 50,
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
  };
}
