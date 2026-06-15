/**
 * Display 称呼 + precedence for consorts (rank/title system). 称呼 recomposes
 * from the CURRENT rank, so a promotion/封号 changes it everywhere automatically.
 */
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { CharacterStanding } from "../state/types";

/** A 封号 nudges a consort just above untitled same-rank peers (< adjacent-rank gap). */
export const TITLE_BOOST = 1;

export function resolveDisplayName(
  character: CharacterContent,
  standing: CharacterStanding | undefined,
  rank: CharacterRank | undefined,
): string {
  if (character.kind === "consort" && character.profile.surname && rank) {
    return (standing?.title ?? character.profile.surname) + rank.name;
  }
  return character.profile.name;
}

export function effectiveOrder(rank: CharacterRank, hasTitle: boolean): number {
  return rank.order + (hasTitle ? TITLE_BOOST : 0);
}
