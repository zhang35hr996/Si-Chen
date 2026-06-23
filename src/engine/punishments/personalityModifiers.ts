/**
 * Centralised mapping from canonical reactionTraits → punishment consequence
 * modifiers.  All personality logic lives here; no switch/if-chains elsewhere.
 *
 * Multipliers are applied to the baseline delta computed from PunishmentSeverity
 * tables.  DeltaAdds are added after multiplication (flat offsets).
 * Unknown traits produce the neutral modifier (all 1.0 / 0).
 */
import type { CanonicalReactionTrait } from "../content/schemas";
import type { PunishmentSeverity } from "./types";

export interface PunishmentPersonalityModifier {
  /** Multiplier for the affection delta (default 1.0). */
  affectionMul: number;
  /** Multiplier for the fear delta (default 1.0). */
  fearMul: number;
  /** Flat addition to loyalty delta after multiplying (negative = extra drop). */
  loyaltyDeltaAdd: number;
  /** Flat addition to ambition delta (positive = extra rise). */
  ambitionDeltaAdd: number;
  /** Extra health delta for severe/terminal punishment (negative = extra drop). */
  healthDeltaAdd: number;
  /**
   * Multiplier for the visible reaction score used when selecting top-3 beats.
   * < 1.0 lowers the chance of appearing as a visible beat (e.g. discreet).
   */
  reactionVisibilityMul: number;
}

const NEUTRAL: PunishmentPersonalityModifier = {
  affectionMul: 1.0,
  fearMul: 1.0,
  loyaltyDeltaAdd: 0,
  ambitionDeltaAdd: 0,
  healthDeltaAdd: 0,
  reactionVisibilityMul: 1.0,
};

/** Per-trait modifier table.  Traits are combined by summing add fields and
 *  averaging multiplier fields when a character has multiple traits. */
const TRAIT_MODIFIERS: Record<CanonicalReactionTrait, PunishmentPersonalityModifier> = {
  compassionate: {
    affectionMul: 1.0,
    fearMul: 1.2,        // more frightened
    loyaltyDeltaAdd: 2,  // loyalty drops less (positive add offsets the negative baseline)
    ambitionDeltaAdd: -1,
    healthDeltaAdd: 0,
    reactionVisibilityMul: 1.1,
  },
  proud: {
    affectionMul: 1.4,   // affection drops more sharply
    fearMul: 0.6,        // less fearful
    loyaltyDeltaAdd: -3, // loyalty drops more
    ambitionDeltaAdd: 0, // depends on severity (handled below)
    healthDeltaAdd: 0,
    reactionVisibilityMul: 1.2,
  },
  calculating: {
    affectionMul: 0.9,
    fearMul: 0.9,
    loyaltyDeltaAdd: 0,
    ambitionDeltaAdd: 0, // depends on severity (handled below)
    healthDeltaAdd: 0,
    reactionVisibilityMul: 0.8, // calculating types hide reactions
  },
  impulsive: {
    affectionMul: 1.3,
    fearMul: 1.5,
    loyaltyDeltaAdd: -1,
    ambitionDeltaAdd: 0,
    healthDeltaAdd: 0,
    reactionVisibilityMul: 1.3,
  },
  cold: {
    affectionMul: 0.7,
    fearMul: 0.7,
    loyaltyDeltaAdd: 1,
    ambitionDeltaAdd: 0,
    healthDeltaAdd: 0,
    reactionVisibilityMul: 0.75,
  },
  status_conscious: {
    affectionMul: 1.1,
    fearMul: 1.1,
    loyaltyDeltaAdd: -2, // extra loyalty drop on anything that demotes/demeans
    ambitionDeltaAdd: 0,
    healthDeltaAdd: 0,
    reactionVisibilityMul: 1.1,
  },
  discreet: {
    affectionMul: 1.0,
    fearMul: 1.1,
    loyaltyDeltaAdd: 0,
    ambitionDeltaAdd: 0,
    healthDeltaAdd: 0,
    reactionVisibilityMul: 0.35, // discreet consorts rarely surface visible reactions
  },
  blunt: {
    affectionMul: 1.1,
    fearMul: 0.8,
    loyaltyDeltaAdd: 0,
    ambitionDeltaAdd: 0,
    healthDeltaAdd: 0,
    reactionVisibilityMul: 1.25,
  },
};

/** Severity-aware adjustments layered on top of trait modifiers. */
function severityAmbitionDelta(trait: CanonicalReactionTrait, severity: PunishmentSeverity): number {
  if (trait === "proud") {
    return severity === "minor" || severity === "moderate" ? 2 : -1;
  }
  if (trait === "calculating") {
    return severity === "minor" ? 3 : severity === "moderate" ? 2 : 0;
  }
  return 0;
}

function severityHealthDelta(trait: CanonicalReactionTrait, severity: PunishmentSeverity): number {
  // 体弱 is checked via healthStatus at call site; no canonical trait maps to it
  return 0;
  void trait; void severity;
}

/**
 * Compute the combined modifier for a character given their reactionTraits and
 * the punishment severity.  Multiple traits are combined by averaging muls and
 * summing adds.
 */
export function getPersonalityModifier(
  traits: CanonicalReactionTrait[],
  severity: PunishmentSeverity,
): PunishmentPersonalityModifier {
  if (traits.length === 0) return { ...NEUTRAL };

  let affectionMulSum = 0;
  let fearMulSum = 0;
  let reactionVisibilityMulSum = 0;
  let loyaltyDeltaAdd = 0;
  let ambitionDeltaAdd = 0;
  let healthDeltaAdd = 0;

  for (const trait of traits) {
    const m = TRAIT_MODIFIERS[trait] ?? NEUTRAL;
    affectionMulSum      += m.affectionMul;
    fearMulSum           += m.fearMul;
    reactionVisibilityMulSum += m.reactionVisibilityMul;
    loyaltyDeltaAdd      += m.loyaltyDeltaAdd;
    ambitionDeltaAdd     += m.ambitionDeltaAdd + severityAmbitionDelta(trait, severity);
    healthDeltaAdd       += m.healthDeltaAdd + severityHealthDelta(trait, severity);
  }

  const n = traits.length;
  return {
    affectionMul:         affectionMulSum / n,
    fearMul:              fearMulSum / n,
    loyaltyDeltaAdd,
    ambitionDeltaAdd,
    healthDeltaAdd,
    reactionVisibilityMul: reactionVisibilityMulSum / n,
  };
}
