import { fnv1a64Hex } from "../../save/canonical";
import type {
  IntrigueParticipantSnapshot,
  HaremIntrigueKind,
  HaremIntrigueMotive,
  HaremIntrigueRationaleCode,
} from "./types";
import { RATIONALE_CANONICAL_ORDER as RATIONALE_ORDER } from "./types";

export const INTRIGUE_PROPENSITY_THRESHOLD = 45;
export const INTRIGUE_PAIR_THRESHOLD = 45;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Score how likely the actor is to initiate intrigue. 0-100.
 */
export function scoreIntriguePropensity(
  actor: IntrigueParticipantSnapshot,
  maxGrievanceStrength: number,
): number {
  const loyalty = actor.loyalty;
  const fear = actor.fear;
  const lowLoyalty = Math.max(0, 60 - loyalty);
  const fearPressure = Math.max(0, fear - 50);

  const raw =
    actor.ambition * 0.24
    + actor.personality.jealousy * 0.22
    + actor.personality.scheming * 0.22
    + actor.personality.courage * 0.08
    + maxGrievanceStrength * 0.20
    + lowLoyalty * 0.12
    + fearPressure * 0.08
    - actor.personality.compassion * 0.10
    - actor.personality.emotionalStability * 0.06;

  return clamp(Math.round(raw), 0, 100);
}

/**
 * Score how threatening the target is to the actor. 0-100.
 * Also returns component values for the plan record.
 */
export function scoreTargetThreat(
  actor: IntrigueParticipantSnapshot,
  target: IntrigueParticipantSnapshot,
  grievanceStrength: number,
  minHaremOrder: number,
  maxHaremOrder: number,
): {
  score: number;
  favorGap: number;
  peakFavorGap: number;
  rankRivalry: number;
  factionConflict: boolean;
} {
  const favorGap = Math.max(0, target.favor - actor.favor);
  const peakFavorGap = Math.max(0, target.peakFavor - actor.peakFavor);

  const rankRivalry = target.rankOrder <= actor.rankOrder
    ? 0
    : Math.round(
        (target.rankOrder - actor.rankOrder)
        / Math.max(1, maxHaremOrder - minHaremOrder)
        * 100,
      );

  const factionConflict =
    actor.factionId !== undefined &&
    target.factionId !== undefined &&
    actor.factionId !== target.factionId;

  const factionBonus = factionConflict ? 15 : 0;

  const raw =
    favorGap * 0.50
    + peakFavorGap * 0.25
    + rankRivalry * 0.15
    + target.household.servantOpinion * 0.10
    + grievanceStrength * 0.35
    + factionBonus;

  return {
    score: clamp(Math.round(raw), 0, 100),
    favorGap,
    peakFavorGap,
    rankRivalry,
    factionConflict,
  };
}

/**
 * Stable tie jitter for a pair. Returns -2..+2.
 */
export function pairTieJitter(year: number, month: number, actorId: string, targetId: string): number {
  const seed = `harem_intrigue:pair:${year}:${String(month).padStart(2, "0")}:${actorId}:${targetId}`;
  const hash = parseInt(fnv1a64Hex(seed).slice(0, 8), 16);
  return (hash % 5) - 2;
}

/**
 * Score the overall intrigue pair priority. 0-100.
 */
export function scoreIntriguePair(
  actorPropensity: number,
  targetThreat: number,
  tieJitter: number,
): number {
  return clamp(
    Math.round(actorPropensity * 0.55 + targetThreat * 0.45 + tieJitter),
    0,
    100,
  );
}

/**
 * Compute intrigue potency (effectiveness). 10-90.
 */
export function computeIntriguePotency(
  actor: IntrigueParticipantSnapshot,
  kind: HaremIntrigueKind,
  grievanceStrength: number,
  targetThreat: number,
): number {
  const kindBonus: Record<HaremIntrigueKind, number> = {
    slander: 0,
    false_accusation: 5,
    steal_credit: 0,
    faction_pressure: 3,
    servant_subversion: 2,
  };

  const raw =
    actor.personality.scheming * 0.30
    + actor.ambition * 0.18
    + actor.personality.courage * 0.10
    + grievanceStrength * 0.20
    + actor.household.privateWealthLevel * 0.12
    + actor.household.servantOpinion * 0.05
    + targetThreat * 0.10
    + kindBonus[kind];

  return clamp(Math.round(raw), 10, 90);
}

/**
 * Compute intrigue secrecy (concealment). 10-90.
 */
export function computeIntrigueSecrecy(
  actor: IntrigueParticipantSnapshot,
  kind: HaremIntrigueKind,
): number {
  const kindModifier: Record<HaremIntrigueKind, number> = {
    slander: 2,
    false_accusation: -8,
    steal_credit: 0,
    faction_pressure: -12,
    servant_subversion: 5,
  };

  const raw =
    20
    + actor.personality.scheming * 0.35
    + actor.personality.emotionalStability * 0.20
    + actor.household.privateWealthLevel * 0.10
    + (100 - actor.personality.sociability) * 0.08
    - actor.fear * 0.15
    - actor.personality.pride * 0.10
    + kindModifier[kind];

  return clamp(Math.round(raw), 10, 90);
}

/**
 * Choose scheme kind and motive based on actor/target context.
 * Priority order is fixed and tested.
 */
export function chooseIntrigueKindAndMotive(
  actor: IntrigueParticipantSnapshot,
  target: IntrigueParticipantSnapshot,
  context: {
    grievanceStrength: number;
    factionConflict: boolean;
  },
): {
  kind: HaremIntrigueKind;
  motive: HaremIntrigueMotive;
  rationale: HaremIntrigueRationaleCode[];
} {
  const { grievanceStrength, factionConflict } = context;
  let kind: HaremIntrigueKind;
  let motive: HaremIntrigueMotive;

  // Priority 1: false_accusation
  if (grievanceStrength >= 70 && actor.personality.scheming >= 55) {
    kind = "false_accusation";
    motive = "resentment";
  }
  // Priority 2: faction_pressure
  else if (
    factionConflict &&
    actor.personality.courage >= 55 &&
    (actor.personality.pride >= 55 || actor.ambition >= 60)
  ) {
    kind = "faction_pressure";
    motive = "faction";
  }
  // Priority 3: servant_subversion
  else if (
    actor.household.privateWealthLevel >= 60 &&
    actor.personality.scheming >= 60 &&
    target.household.servantOpinion <= 55
  ) {
    kind = "servant_subversion";
    motive = factionConflict && actor.ambition < actor.personality.jealousy
      ? "faction"
      : "ambition";
  }
  // Priority 4: slander
  else if (target.favor - actor.favor >= 20 && actor.personality.jealousy >= 60) {
    kind = "slander";
    motive = "jealousy";
  }
  // Priority 5: steal_credit
  else if (actor.ambition >= 70 && target.peakFavor >= 60) {
    kind = "steal_credit";
    motive = "ambition";
  }
  // Priority 6: fear fallback
  else if (actor.fear >= 70 && actor.loyalty <= 40) {
    kind = "slander";
    motive = "fear";
  }
  // Priority 7: default
  else if (actor.ambition >= 60) {
    kind = "steal_credit";
    motive = "ambition";
  } else {
    kind = "slander";
    motive = "jealousy";
  }

  const rationale = buildRationale(actor, target, {
    grievanceStrength,
    factionConflict,
    favorGap: Math.max(0, target.favor - actor.favor),
    peakFavorGap: Math.max(0, target.peakFavor - actor.peakFavor),
    rankRivalry: target.rankOrder > actor.rankOrder ? 1 : 0, // non-zero = has rivalry
  });

  return { kind, motive, rationale };
}

/**
 * Build rationale codes from actual values, in canonical order.
 */
export function buildRationale(
  actor: IntrigueParticipantSnapshot,
  target: IntrigueParticipantSnapshot,
  computed: {
    grievanceStrength: number;
    factionConflict: boolean;
    favorGap: number;
    peakFavorGap: number;
    rankRivalry: number; // actual numeric value 0-100
  },
): HaremIntrigueRationaleCode[] {
  const active = new Set<HaremIntrigueRationaleCode>();

  if (actor.personality.jealousy >= 60) active.add("high_jealousy");
  if (actor.ambition >= 65) active.add("high_ambition");
  if (actor.personality.scheming >= 60) active.add("high_scheming");
  if (computed.grievanceStrength >= 40) active.add("unresolved_grievance");
  if (computed.favorGap >= 15) active.add("favor_gap");
  if (computed.peakFavorGap >= 15) active.add("peak_favor_gap");
  if (computed.rankRivalry >= 20) active.add("rank_rivalry");
  if (computed.factionConflict) active.add("faction_conflict");
  if (actor.household.privateWealthLevel >= 60) active.add("household_leverage");
  if (actor.loyalty <= 35) active.add("low_loyalty");
  if (actor.fear >= 65) active.add("fear_pressure");
  if (target.household.servantOpinion >= 65) active.add("target_influence");

  // Return in canonical order
  return RATIONALE_ORDER.filter((code) => active.has(code));
}
