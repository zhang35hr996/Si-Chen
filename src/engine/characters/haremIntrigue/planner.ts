import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";
import { resolveConsortRuntimeAttrs } from "../consortAttrs";
import { fnv1a64Hex } from "../../save/canonical";
import {
  runtimeConsortIds,
  checkIntrigueActorEligibility,
  checkIntrigueTargetEligibility,
} from "./eligibility";
import {
  scoreIntriguePropensity,
  scoreTargetThreat,
  scoreIntriguePair,
  pairTieJitter,
  computeIntriguePotency,
  computeIntrigueSecrecy,
  buildRationale,
  INTRIGUE_PROPENSITY_THRESHOLD,
  INTRIGUE_PAIR_THRESHOLD,
  chooseIntrigueKindAndMotive,
} from "./scoring";
import type {
  HaremIntriguePlan,
  HaremIntriguePlanningContext,
  HaremIntrigueCandidate,
  IntrigueParticipantSnapshot,
} from "./types";

/**
 * Build the source key for a month.
 */
export function buildIntrigueSourceKey(year: number, month: number): string {
  return `harem_intrigue:${year}:${String(month).padStart(2, "0")}`;
}

/**
 * Build a participant snapshot from current state. Returns null if not fully resolvable.
 */
function buildParticipantSnapshot(
  db: ContentDB,
  state: GameState,
  charId: string,
): IntrigueParticipantSnapshot | null {
  const standing = state.standing[charId];
  if (!standing) return null;

  const rank = db.ranks[standing.rank];
  if (!rank || rank.domain !== "harem") return null;

  const attrs = resolveConsortRuntimeAttrs(db, state, charId);

  return {
    characterId: charId,
    rankId: standing.rank,
    rankOrder: rank.order,
    favor: standing.favor,
    peakFavor: standing.peakFavor,
    affection: attrs.affection,
    fear: attrs.fear,
    ambition: attrs.ambition,
    loyalty: attrs.loyalty,
    factionId: standing.haremFactionId,
    personality: {
      scheming: attrs.personality.scheming,
      sociability: attrs.personality.sociability,
      compassion: attrs.personality.compassion,
      courage: attrs.personality.courage,
      jealousy: attrs.personality.jealousy,
      emotionalStability: attrs.personality.emotionalStability,
      pride: attrs.personality.pride,
      intelligence: attrs.personality.intelligence,
    },
    household: {
      servantOpinion: attrs.household.servantOpinion,
      livingStandard: attrs.household.livingStandard,
      privateWealthLevel: attrs.household.privateWealthLevel,
    },
  };
}

/**
 * Get harem rank bounds (min/max order) for rank rivalry calculation.
 */
function getHaremRankBounds(db: ContentDB): { minOrder: number; maxOrder: number } {
  const haremOrders = Object.values(db.ranks)
    .filter((r) => r.domain === "harem")
    .map((r) => r.order);

  if (haremOrders.length === 0) return { minOrder: 0, maxOrder: 100 };

  return {
    minOrder: Math.min(...haremOrders),
    maxOrder: Math.max(...haremOrders),
  };
}

/**
 * Enumerate all viable intrigue candidates (actor-target pairs).
 */
export function enumerateIntrigueCandidates(
  db: ContentDB,
  state: GameState,
  context: HaremIntriguePlanningContext,
): readonly HaremIntrigueCandidate[] {
  const { at } = context;
  const consortIds = runtimeConsortIds(state);
  const { minOrder, maxOrder } = getHaremRankBounds(db);

  // Build grievance index: actorId -> Map<targetId, strength>
  // to avoid O(n²×m) grievance lookups
  const grievanceIndex = new Map<string, Map<string, number>>();
  for (const actorId of consortIds) {
    const targetMap = new Map<string, number>();
    grievanceIndex.set(actorId, targetMap);
    const store = state.memories[actorId];
    if (store) {
      for (const entry of store.entries) {
        if (entry.kind === "grievance" && entry.unresolved) {
          for (const subjectId of entry.subjectIds) {
            const curr = targetMap.get(subjectId) ?? 0;
            if (entry.strength > curr) {
              targetMap.set(subjectId, entry.strength);
            }
          }
        }
      }
    }
  }

  // Cache snapshots
  const snapshotCache = new Map<string, IntrigueParticipantSnapshot | null>();
  function getSnapshot(id: string): IntrigueParticipantSnapshot | null {
    if (!snapshotCache.has(id)) {
      snapshotCache.set(id, buildParticipantSnapshot(db, state, id));
    }
    return snapshotCache.get(id) ?? null;
  }

  const candidates: HaremIntrigueCandidate[] = [];

  for (const actorId of consortIds) {
    // Check actor eligibility
    const actorElig = checkIntrigueActorEligibility(db, state, actorId, at);
    if (!actorElig.eligible) continue;

    const actorSnap = getSnapshot(actorId);
    if (!actorSnap) continue;

    // Get max grievance for propensity (against all targets, max single value)
    const actorGrievanceMap = grievanceIndex.get(actorId)!;
    const maxGrievanceForPropensity = actorGrievanceMap.size > 0
      ? Math.max(...actorGrievanceMap.values())
      : 0;

    const propensity = scoreIntriguePropensity(actorSnap, maxGrievanceForPropensity);
    if (propensity < INTRIGUE_PROPENSITY_THRESHOLD) continue;

    for (const targetId of consortIds) {
      if (targetId === actorId) continue;

      // Check target eligibility
      const targetElig = checkIntrigueTargetEligibility(db, state, targetId);
      if (!targetElig.eligible) continue;

      const targetSnap = getSnapshot(targetId);
      if (!targetSnap) continue;

      // Get grievance strength for this specific pair
      const grievanceStrength = actorGrievanceMap.get(targetId) ?? 0;

      // Score threat
      const threatResult = scoreTargetThreat(
        actorSnap, targetSnap, grievanceStrength, minOrder, maxOrder,
      );

      // Score pair priority
      const tieJitter = pairTieJitter(at.year, at.month, actorId, targetId);
      const priority = scoreIntriguePair(propensity, threatResult.score, tieJitter);

      if (priority < INTRIGUE_PAIR_THRESHOLD) continue;

      // Choose kind/motive
      const { kind, motive } = chooseIntrigueKindAndMotive(actorSnap, targetSnap, {
        grievanceStrength,
        factionConflict: threatResult.factionConflict,
      });

      // Compute potency and secrecy
      const potency = computeIntriguePotency(actorSnap, kind, grievanceStrength, threatResult.score);
      const secrecy = computeIntrigueSecrecy(actorSnap, kind);

      candidates.push({
        actorId,
        targetId,
        actorPropensity: propensity,
        targetThreat: threatResult.score,
        priority,
        kind,
        motive,
        potency,
        secrecy,
        tieBreak: parseInt(fnv1a64Hex(`harem_intrigue:tie:${actorId}:${targetId}`).slice(0, 8), 16),
      });
    }
  }

  return candidates;
}

/**
 * Plan the monthly harem intrigue. Returns null if no valid scheme can be planned.
 * Deterministic: same inputs → same output.
 */
export function planMonthlyHaremIntrigue(
  db: ContentDB,
  state: GameState,
  context: HaremIntriguePlanningContext,
): HaremIntriguePlan | null {
  const { at } = context;
  const sourceKey = buildIntrigueSourceKey(at.year, at.month);

  // 1. Already planned for this month
  if (context.existingSourceKeys?.has(sourceKey)) return null;

  // 2. Enumerate candidates
  const candidates = enumerateIntrigueCandidates(db, state, context);
  if (candidates.length === 0) return null;

  // 3. Sort: priority desc → tieBreak asc → actorId asc → targetId asc
  const sorted = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.tieBreak !== b.tieBreak) return a.tieBreak - b.tieBreak;
    if (a.actorId !== b.actorId) return a.actorId < b.actorId ? -1 : 1;
    return a.targetId < b.targetId ? -1 : 1;
  });

  const best = sorted[0]!;

  // 4. Build full plan
  const { minOrder, maxOrder } = getHaremRankBounds(db);
  const actorSnap = buildParticipantSnapshot(db, state, best.actorId)!;
  const targetSnap = buildParticipantSnapshot(db, state, best.targetId)!;

  const actorGrievanceMap = new Map<string, number>();
  const store = state.memories[best.actorId];
  if (store) {
    for (const entry of store.entries) {
      if (entry.kind === "grievance" && entry.unresolved) {
        for (const subjectId of entry.subjectIds) {
          const curr = actorGrievanceMap.get(subjectId) ?? 0;
          if (entry.strength > curr) actorGrievanceMap.set(subjectId, entry.strength);
        }
      }
    }
  }
  const grievanceStrength = actorGrievanceMap.get(best.targetId) ?? 0;

  const threatResult = scoreTargetThreat(actorSnap, targetSnap, grievanceStrength, minOrder, maxOrder);
  const { kind, motive } = chooseIntrigueKindAndMotive(
    actorSnap, targetSnap,
    { grievanceStrength, factionConflict: threatResult.factionConflict },
  );

  // Build full rationale with exact rankRivalry value
  const rationale = buildRationale(actorSnap, targetSnap, {
    grievanceStrength,
    factionConflict: threatResult.factionConflict,
    favorGap: threatResult.favorGap,
    peakFavorGap: threatResult.peakFavorGap,
    rankRivalry: threatResult.rankRivalry,
  });

  const tieJitter = pairTieJitter(at.year, at.month, best.actorId, best.targetId);
  const propensity = best.actorPropensity;
  const priority = scoreIntriguePair(propensity, threatResult.score, tieJitter);
  const potency = computeIntriguePotency(actorSnap, kind, grievanceStrength, threatResult.score);
  const secrecy = computeIntrigueSecrecy(actorSnap, kind);

  return {
    sourceKey,
    plannedAt: { ...at },
    year: at.year,
    month: at.month,
    actorId: best.actorId,
    targetId: best.targetId,
    kind,
    motive,
    actorPropensity: propensity,
    targetThreat: threatResult.score,
    priority,
    potency,
    secrecy,
    grievanceStrength,
    factionConflict: threatResult.factionConflict,
    actorSnapshot: actorSnap,
    targetSnapshot: targetSnap,
    rationale,
  };
}
