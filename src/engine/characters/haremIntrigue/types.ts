import type { GameTime } from "../../calendar/time";

export type HaremIntrigueKind =
  | "slander"
  | "false_accusation"
  | "steal_credit"
  | "faction_pressure"
  | "servant_subversion";

export type HaremIntrigueMotive =
  | "jealousy"
  | "ambition"
  | "resentment"
  | "fear"
  | "faction";

export type HaremIntrigueRationaleCode =
  | "high_jealousy"
  | "high_ambition"
  | "high_scheming"
  | "unresolved_grievance"
  | "favor_gap"
  | "peak_favor_gap"
  | "rank_rivalry"
  | "faction_conflict"
  | "household_leverage"
  | "low_loyalty"
  | "fear_pressure"
  | "target_influence";

// CANONICAL ORDER for rationale codes (for stable output):
export const RATIONALE_CANONICAL_ORDER: readonly HaremIntrigueRationaleCode[] = [
  "high_jealousy", "high_ambition", "high_scheming", "unresolved_grievance",
  "favor_gap", "peak_favor_gap", "rank_rivalry", "faction_conflict",
  "household_leverage", "low_loyalty", "fear_pressure", "target_influence",
];

export interface IntrigueParticipantSnapshot {
  characterId: string;
  rankId: string;
  rankOrder: number;
  favor: number;
  peakFavor: number;
  affection: number;
  fear: number;
  ambition: number;
  loyalty: number;
  factionId?: string;
  personality: {
    scheming: number;
    sociability: number;
    compassion: number;
    courage: number;
    jealousy: number;
    emotionalStability: number;
    pride: number;
    intelligence?: number;
  };
  household: {
    servantOpinion: number;
    livingStandard: number;
    privateWealthLevel: number;
  };
}

export interface HaremIntriguePlan {
  sourceKey: string;  // "harem_intrigue:{year}:{MM}" e.g. "harem_intrigue:3:07"
  plannedAt: GameTime;
  year: number;
  month: number;
  actorId: string;
  targetId: string;
  kind: HaremIntrigueKind;
  motive: HaremIntrigueMotive;
  actorPropensity: number;   // 0-100 integer
  targetThreat: number;      // 0-100 integer
  priority: number;          // 0-100 integer
  potency: number;           // 10-90 integer
  secrecy: number;           // 10-90 integer
  grievanceStrength: number; // 0-100 integer
  factionConflict: boolean;
  actorSnapshot: IntrigueParticipantSnapshot;
  targetSnapshot: IntrigueParticipantSnapshot;
  rationale: HaremIntrigueRationaleCode[];
}

export interface HaremIntriguePlanningContext {
  at: GameTime;
  existingSourceKeys?: ReadonlySet<string>;
}

export interface HaremIntrigueCandidate {
  actorId: string;
  targetId: string;
  actorPropensity: number;
  targetThreat: number;
  priority: number;
  kind: HaremIntrigueKind;
  motive: HaremIntrigueMotive;
  potency: number;
  secrecy: number;
  tieBreak: number;
}

export type HaremIntrigueCancellationReason =
  | "actor_unavailable"
  | "target_unavailable"
  | "actor_target_same"
  | "plan_invalid";

export interface IntrigueStandingDelta {
  characterId: string;
  favor?: number;
  affection?: number;
  fear?: number;
  loyalty?: number;
}

export interface IntrigueHouseholdDelta {
  characterId: string;
  servantOpinion?: number;
  livingStandard?: number;
  privateWealthLevel?: number;
}

export interface IntrigueNationDelta {
  rumor?: number;
}

export interface HaremIntrigueConsequencePlan {
  standing: IntrigueStandingDelta[];
  household: IntrigueHouseholdDelta[];
  nation: IntrigueNationDelta;
}

export interface HaremIntrigueKnowledgePlan {
  actorKnowsOwnAction: true;
  targetKnowsInstigator: boolean;
  palacePublic: boolean;
}

export interface HaremIntrigueResolvedOutcome {
  status: "resolved";
  resolvedAt: GameTime;
  successRoll: number;
  successThreshold: number;
  success: boolean;
  discoveryRoll: number;
  discoveryThreshold: number;
  discovered: boolean;
  consequences: HaremIntrigueConsequencePlan;
  knowledge: HaremIntrigueKnowledgePlan;
}

export interface HaremIntrigueCancelledOutcome {
  status: "cancelled";
  resolvedAt: GameTime;
  reason: HaremIntrigueCancellationReason;
  consequences: {
    standing: [];
    household: [];
    nation: Record<string, never>;
  };
  knowledge: {
    actorKnowsOwnAction: true;
    targetKnowsInstigator: false;
    palacePublic: false;
  };
}

export type HaremIntrigueOutcome =
  | HaremIntrigueResolvedOutcome
  | HaremIntrigueCancelledOutcome;

export type HaremIntrigueValidationCode =
  | "INTRIGUE_BAD_SOURCE_KEY"
  | "INTRIGUE_BAD_TIME"
  | "INTRIGUE_SELF_TARGET"
  | "INTRIGUE_UNKNOWN_KIND"
  | "INTRIGUE_UNKNOWN_MOTIVE"
  | "INTRIGUE_BAD_SCORE"
  | "INTRIGUE_BAD_POTENCY"
  | "INTRIGUE_BAD_SECRECY"
  | "INTRIGUE_BAD_GRIEVANCE"
  | "INTRIGUE_SNAPSHOT_ID_MISMATCH"
  | "INTRIGUE_BAD_SNAPSHOT_VALUE"
  | "INTRIGUE_BAD_RATIONALE"
  | "INTRIGUE_DUP_RATIONALE"
  | "INTRIGUE_KIND_MOTIVE_MISMATCH";

export interface HaremIntrigueValidationFinding {
  code: HaremIntrigueValidationCode;
  message: string;
}
