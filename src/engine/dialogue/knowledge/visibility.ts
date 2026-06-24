import type { KnowledgeVisibility } from "../../knowledge/model";
import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";

/**
 * Resolves the knowledge visibility ceiling for a given speaker.
 *
 * Access matrix (strict — do not widen without a security review):
 *   player / sovereign → "imperial"   (player identity speaks to/from the throne)
 *   consort            → "restricted"
 *   official           → "restricted"
 *   elder              → "restricted"
 *   unknown            → "public"
 *
 * Rules:
 * - Scene privacy and palace location do NOT affect the ceiling.
 * - Generated consorts (state.generatedConsorts) are resolved to "restricted"
 *   identically to db-registered consorts.
 * - Unknown speaker IDs (not in db.characters and not a generated consort) → "public".
 * - The fallback from a missing character is "public", not "restricted", so an
 *   unknown speaker cannot accidentally gain elevated access.
 */
export function resolveVisibilityCeiling(
  speakerId: string,
  db: ContentDB,
  state: GameState,
): KnowledgeVisibility {
  if (speakerId === "player" || speakerId === "sovereign") {
    return "imperial";
  }

  const character = db.characters[speakerId];
  if (character) {
    switch (character.kind) {
      case "consort":  return "restricted";
      case "official": return "restricted";
      case "elder":    return "restricted";
    }
  }

  // Generated consorts live in state (not content db) — treat them as restricted.
  if (state.generatedConsorts?.[speakerId] !== undefined) {
    return "restricted";
  }

  // Unknown speaker → conservative fallback (never elevate unknown identities).
  return "public";
}
