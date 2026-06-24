import type { KnowledgeVisibility } from "../../knowledge/model";
import type { CharacterContent } from "../../content/schemas";

/**
 * Maps speaker character kind to the visibility ceiling for knowledge retrieval.
 * The ceiling is the MAXIMUM visibility level the speaker is permitted to access.
 * "elder" speakers (太后 etc.) have inner-court status → "restricted".
 * All others default to "public".
 */
export function resolveVisibilityCeiling(speakerKind: CharacterContent["kind"]): KnowledgeVisibility {
  switch (speakerKind) {
    case "elder": return "restricted";
    default: return "public";
  }
}
