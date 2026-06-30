import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import { getBiologicalParents } from "./parentage/parentageSelectors";

/**
 * Position of actorRankId relative to targetRankId in the rank hierarchy.
 * Positive = actor is higher. Negative = actor is lower. 0 = same rank.
 * Returns null if either rank is invalid or not in db.ranks.
 *
 * Uses rank.order: higher order = higher rank.
 */
export function rankDistance(
  db: ContentDB,
  actorRankId: string,
  targetRankId: string,
): number | null {
  const actorRank = db.ranks[actorRankId];
  const targetRank = db.ranks[targetRankId];
  if (!actorRank || !targetRank) return null;
  return actorRank.order - targetRank.order;
}

/**
 * Number of living heirs biologically fathered by consortId.
 * Reads parentage authority (not the Heir.fatherId mirror).
 * Does not count heirs in carrier lifecycle (not yet born) or deceased heirs.
 */
export function livingHeirCountForConsort(state: GameState, consortId: string): number {
  return state.resources.bloodline.heirs.filter(
    (h) => getBiologicalParents(state, h.id)?.fatherId === consortId && h.lifecycle !== "deceased",
  ).length;
}

/**
 * Whether this consort is currently carrying (pregnant with) an heir.
 * Queries the authoritative gestation record, not the derived standing lifecycle.
 */
export function isCurrentCarrier(state: GameState, consortId: string): boolean {
  return state.resources.bloodline.gestations.some((g) => g.carrier === consortId);
}

export type FavoriteStatus =
  | "current_new_favorite"
  | "fallen_new_favorite"
  | "former_favorite"
  | "ordinary";

/**
 * Classify a consort's current favorite status based on favor trajectory, peak, and time in palace.
 * Uses conservative fallback for consorts without precise entry month data.
 */
export function getFavoriteStatus(
  state: GameState,
  consortId: string,
): FavoriteStatus {
  const st = state.standing[consortId];
  if (!st) return "ordinary";

  const { favor, peakFavor } = st;
  const cal = state.calendar;

  // Compute full months in palace.
  let fullMonths: number | null = null;
  if (st.palaceEnteredAt) {
    const enteredYear = st.palaceEnteredAt.year;
    const enteredMonth = st.palaceEnteredAt.month;
    fullMonths =
      (cal.year - enteredYear) * 12 + (cal.month - enteredMonth);
  }

  // Conservative: if we only know entry year (no month), use year boundary.
  // fullMonths === null means we don't know — treat as long-tenured.
  const isDefinitelyNew = fullMonths !== null && fullMonths <= 12;

  if (isDefinitelyNew && favor >= 60) return "current_new_favorite";
  if (isDefinitelyNew && peakFavor >= 70 && favor <= 35) return "fallen_new_favorite";
  if (!isDefinitelyNew && peakFavor >= 75 && favor < 60) return "former_favorite";
  return "ordinary";
}

export interface ImperialProtectionSnapshot {
  currentFavor: number;
  peakFavor: number;
  livingHeirCount: number;
  isCurrentCarrier: boolean;
  favoriteStatus: FavoriteStatus;
  /** Protection score used by harem discipline planners. */
  score: number;
}

/**
 * Compute the imperial protection snapshot for a consort.
 * Higher score = more dangerous to target this consort.
 *
 * Formula:
 *   floor(currentFavor / 5)
 *   + floor(peakFavor / 10)
 *   + min(livingHeirCount, 3) * 8
 *   + 6 if currently carrying
 */
export function imperialProtectionSnapshot(
  _db: ContentDB,
  state: GameState,
  charId: string,
): ImperialProtectionSnapshot {
  const st = state.standing[charId];
  const currentFavor = st?.favor ?? 0;
  const peak = st?.peakFavor ?? currentFavor;
  const heirCount = livingHeirCountForConsort(state, charId);
  const carrying = isCurrentCarrier(state, charId);
  const favoriteStatus = getFavoriteStatus(state, charId);

  const score =
    Math.floor(currentFavor / 5) +
    Math.floor(peak / 10) +
    Math.min(heirCount, 3) * 8 +
    (carrying ? 6 : 0);

  return {
    currentFavor,
    peakFavor: peak,
    livingHeirCount: heirCount,
    isCurrentCarrier: carrying,
    favoriteStatus,
    score,
  };
}
