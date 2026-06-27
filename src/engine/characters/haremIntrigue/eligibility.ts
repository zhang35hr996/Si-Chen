import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";
import { isInColdPalace } from "../coldPalace";
import { isConfined } from "../confinement";
import { monthOrdinal } from "../../calendar/time";
import type { GameTime } from "../../calendar/time";

export type IntrigueIneligibilityReason =
  | "not_in_bedchamber"
  | "no_standing"
  | "is_candidate"
  | "is_deceased"
  | "in_cold_palace"
  | "in_confinement"
  | "critical_health"
  | "invalid_rank"
  | "non_harem_rank"
  | "no_personality"
  | "no_household"
  | "is_player"
  | "is_carrying"
  | "is_postpartum";

export interface IntrigueEligibility {
  eligible: boolean;
  reasons: IntrigueIneligibilityReason[];
}

/**
 * Returns canonical runtime consort IDs from state.bedchamber.
 * Sorted, deduplicated, no insertion-order dependence.
 */
export function runtimeConsortIds(state: GameState): string[] {
  return Array.from(new Set(Object.keys(state.bedchamber))).sort();
}

/**
 * Common eligibility checks for both actors and targets.
 */
function commonEligibility(
  db: ContentDB,
  state: GameState,
  charId: string,
): IntrigueIneligibilityReason[] {
  const reasons: IntrigueIneligibilityReason[] = [];
  const consortIds = runtimeConsortIds(state);

  if (!consortIds.includes(charId)) {
    reasons.push("not_in_bedchamber");
  }

  const standing = state.standing[charId];
  if (!standing) {
    reasons.push("no_standing");
    return reasons; // can't check further without standing
  }

  const lifecycle = standing.lifecycle ?? "normal";
  if (lifecycle === "candidate") reasons.push("is_candidate");
  if (lifecycle === "deceased") reasons.push("is_deceased");

  if (isInColdPalace(state, charId)) reasons.push("in_cold_palace");
  if (isConfined(state, charId)) reasons.push("in_confinement");

  if ((standing.healthStatus ?? "healthy") === "critical") reasons.push("critical_health");

  const rank = db.ranks[standing.rank];
  if (!rank) {
    reasons.push("invalid_rank");
  } else if (rank.domain !== "harem") {
    reasons.push("non_harem_rank");
  }

  return reasons;
}

export function checkIntrigueActorEligibility(
  db: ContentDB,
  state: GameState,
  actorId: string,
  at: GameTime,
): IntrigueEligibility {
  const reasons = commonEligibility(db, state, actorId);

  // Actor-specific: not carrying
  const isCarrying = state.resources.bloodline.gestations.some(
    (g) => g.carrier === actorId,
  );
  if (isCarrying) reasons.push("is_carrying");

  // Actor-specific: not in postpartum recovery
  // Boundary: currentMonth < recoverUntilMonth means still recovering;
  // at recoverUntilMonth itself the actor is eligible (recovery completed).
  const standing = state.standing[actorId];
  if (standing?.recoverUntilMonth !== undefined) {
    const currentOrdinal = monthOrdinal(at);
    if (currentOrdinal < standing.recoverUntilMonth) {
      reasons.push("is_postpartum");
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

export function checkIntrigueTargetEligibility(
  db: ContentDB,
  state: GameState,
  targetId: string,
): IntrigueEligibility {
  const reasons = commonEligibility(db, state, targetId);
  // target carrying is ALLOWED (non-physical schemes)
  // target postpartum is ALLOWED
  return { eligible: reasons.length === 0, reasons };
}
