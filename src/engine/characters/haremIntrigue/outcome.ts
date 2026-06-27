import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";
import type { GameTime } from "../../calendar/time";
import { fnv1a64Hex } from "../../save/canonical";
import { isInColdPalace } from "../coldPalace";
import { isConfined } from "../confinement";
import { resolveConsortRuntimeAttrs } from "../consortAttrs";
import type {
  HaremIntriguePlan,
  HaremIntrigueOutcome,
  HaremIntrigueConsequencePlan,
  IntrigueStandingDelta,
  IntrigueHouseholdDelta,
  IntrigueNationDelta,
} from "./types";

/**
 * Deterministic roll 0-99 from seed string using FNV-1a.
 */
function intrigueRoll(seed: string): number {
  return parseInt(fnv1a64Hex(seed).slice(0, 8), 16) % 100;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Compute success threshold based on current state (not snapshot).
 */
function computeSuccessThreshold(
  db: ContentDB,
  state: GameState,
  plan: HaremIntriguePlan,
): number {
  const targetId = plan.targetId;
  const actorId = plan.actorId;

  const targetAttrs = resolveConsortRuntimeAttrs(db, state, targetId);
  const actorStanding = state.standing[actorId];
  const targetStanding = state.standing[targetId];

  const actorRank = db.ranks[actorStanding?.rank ?? ""];
  const targetRank = db.ranks[targetStanding?.rank ?? ""];

  const targetResistance =
    targetAttrs.personality.emotionalStability * 0.25
    + targetAttrs.personality.sociability * 0.10
    + targetAttrs.household.servantOpinion * 0.15
    + targetAttrs.loyalty * 0.10;

  // Rank protection: target rank order > actor rank order
  let rankProtection = 0;
  if (actorRank && targetRank) {
    const haremOrders = Object.values(db.ranks)
      .filter((r) => r.domain === "harem")
      .map((r) => r.order);
    const minOrder = Math.min(...haremOrders);
    const maxOrder = Math.max(...haremOrders);

    if (targetRank.order > actorRank.order) {
      rankProtection = clamp(
        Math.round(
          (targetRank.order - actorRank.order)
          / Math.max(1, maxOrder - minOrder)
          * 100,
        ),
        0,
        100,
      );
    }
  }

  const raw =
    25
    + plan.potency * 0.55
    + plan.actorSnapshot.personality.courage * 0.10
    - targetResistance * 0.40
    - rankProtection * 0.10;

  return clamp(Math.round(raw), 10, 90);
}

/**
 * Compute discovery threshold based on current state.
 */
function computeDiscoveryThreshold(
  db: ContentDB,
  state: GameState,
  plan: HaremIntriguePlan,
): number {
  const targetId = plan.targetId;
  const targetAttrs = resolveConsortRuntimeAttrs(db, state, targetId);

  const raw =
    15
    + (100 - plan.secrecy) * 0.55
    + targetAttrs.personality.sociability * 0.10
    + targetAttrs.household.servantOpinion * 0.10
    + state.resources.sovereign.diligence * 0.15;

  return clamp(Math.round(raw), 5, 90);
}

/**
 * Build consequence plan for a resolved outcome.
 * Merges deltas per character, removes zero values.
 */
export function buildIntrigueConsequences(
  plan: HaremIntriguePlan,
  success: boolean,
  discovered: boolean,
): HaremIntrigueConsequencePlan {
  const standingMap = new Map<string, Partial<Record<"favor" | "affection" | "fear" | "loyalty", number>>>();
  const householdMap = new Map<string, Partial<Record<"servantOpinion" | "livingStandard" | "privateWealthLevel", number>>>();
  let rumorDelta = 0;

  function addStanding(id: string, field: "favor" | "affection" | "fear" | "loyalty", delta: number): void {
    const curr = standingMap.get(id) ?? {};
    curr[field] = (curr[field] ?? 0) + delta;
    standingMap.set(id, curr);
  }

  function addHousehold(id: string, field: "servantOpinion" | "livingStandard" | "privateWealthLevel", delta: number): void {
    const curr = householdMap.get(id) ?? {};
    curr[field] = (curr[field] ?? 0) + delta;
    householdMap.set(id, curr);
  }

  const actor = plan.actorId;
  const target = plan.targetId;

  if (success) {
    switch (plan.kind) {
      case "slander":
        addStanding(target, "favor", -4);
        addStanding(target, "affection", -2);
        rumorDelta += 1;
        break;
      case "false_accusation":
        addStanding(target, "favor", -5);
        addStanding(target, "fear", 5);
        addStanding(target, "affection", -3);
        break;
      case "steal_credit":
        addStanding(actor, "favor", 3);
        addStanding(actor, "affection", 2);
        addStanding(target, "favor", -2);
        break;
      case "faction_pressure":
        addStanding(target, "fear", 6);
        addStanding(target, "loyalty", -4);
        rumorDelta += 1;
        break;
      case "servant_subversion":
        addHousehold(target, "servantOpinion", -6);
        addHousehold(actor, "servantOpinion", 2);
        addStanding(target, "fear", 2);
        break;
    }
  } else {
    // Failure
    switch (plan.kind) {
      case "slander":
        addStanding(actor, "fear", 2);
        break;
      case "false_accusation":
        addStanding(actor, "fear", 3);
        break;
      case "steal_credit":
        addStanding(actor, "fear", 2);
        break;
      case "faction_pressure":
        addStanding(actor, "fear", 3);
        break;
      case "servant_subversion":
        addHousehold(actor, "servantOpinion", -2);
        addStanding(actor, "fear", 1);
        break;
    }
  }

  // Discovery bonus always applies regardless of success
  if (discovered) {
    addStanding(actor, "favor", -4);
    addStanding(actor, "fear", 5);
    rumorDelta += 2;
  }

  // Build standing deltas: filter zero, clamp [-10, +10], sort by characterId
  const standing: IntrigueStandingDelta[] = Array.from(standingMap.entries())
    .map(([characterId, fields]) => {
      const delta: IntrigueStandingDelta = { characterId };
      for (const [field, value] of Object.entries(fields) as Array<["favor" | "affection" | "fear" | "loyalty", number]>) {
        const clamped = clamp(value, -10, 10);
        if (clamped !== 0) delta[field] = clamped;
      }
      return delta;
    })
    .filter((d) => Object.keys(d).length > 1) // more than just characterId
    .sort((a, b) => a.characterId < b.characterId ? -1 : 1);

  // Build household deltas
  const household: IntrigueHouseholdDelta[] = Array.from(householdMap.entries())
    .map(([characterId, fields]) => {
      const delta: IntrigueHouseholdDelta = { characterId };
      for (const [field, value] of Object.entries(fields) as Array<["servantOpinion" | "livingStandard" | "privateWealthLevel", number]>) {
        const clamped = clamp(value, -10, 10);
        if (clamped !== 0) delta[field] = clamped;
      }
      return delta;
    })
    .filter((d) => Object.keys(d).length > 1)
    .sort((a, b) => a.characterId < b.characterId ? -1 : 1);

  const nation: IntrigueNationDelta = {};
  if (rumorDelta !== 0) nation.rumor = clamp(rumorDelta, -10, 10);

  return { standing, household, nation };
}

/**
 * Internal plan validation (structural only) to avoid circular import.
 * Returns true if plan is structurally valid enough to resolve.
 */
function isPlanResoluble(plan: HaremIntriguePlan): boolean {
  if (!plan.actorId || !plan.targetId) return false;
  if (plan.actorId === plan.targetId) return false;
  const sourceKeyRegex = /^harem_intrigue:\d+:\d{2}$/;
  if (!sourceKeyRegex.test(plan.sourceKey)) return false;
  const parts = plan.sourceKey.split(":");
  const keyYear = parseInt(parts[1]!, 10);
  const keyMonth = parseInt(parts[2]!, 10);
  if (keyYear !== plan.year || keyMonth !== plan.month) return false;
  if (plan.plannedAt.year !== plan.year || plan.plannedAt.month !== plan.month) return false;
  return true;
}

/**
 * Resolve a planned intrigue scheme at execution time.
 * Re-checks eligibility; uses current state for resistance/discovery.
 */
export function resolveIntrigueOutcome(
  db: ContentDB,
  state: GameState,
  plan: HaremIntriguePlan,
  resolvedAt: GameTime,
): HaremIntrigueOutcome {
  // 1. Validate plan structurally
  if (!isPlanResoluble(plan)) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "plan_invalid",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  const { actorId, targetId, sourceKey } = plan;

  // 2. Self-target sanity
  if (actorId === targetId) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "actor_target_same",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  // 3. Check actor current availability
  const actorStanding = state.standing[actorId];
  if (!actorStanding) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  const actorLifecycle = actorStanding.lifecycle ?? "normal";
  if (actorLifecycle === "deceased" || actorLifecycle === "candidate") {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  if (isInColdPalace(state, actorId) || isConfined(state, actorId)) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  if ((actorStanding.healthStatus ?? "healthy") === "critical") {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  // Actor became carrying after planning → cancel
  const actorIsCarrying = state.resources.bloodline.gestations.some(
    (g) => g.carrier === actorId,
  );
  if (actorIsCarrying) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "actor_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  // 4. Check target current availability
  const targetStanding = state.standing[targetId];
  if (!targetStanding) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "target_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  const targetLifecycle = targetStanding.lifecycle ?? "normal";
  if (targetLifecycle === "deceased" || targetLifecycle === "candidate") {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "target_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  if (isInColdPalace(state, targetId) || isConfined(state, targetId)) {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "target_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  if ((targetStanding.healthStatus ?? "healthy") === "critical") {
    return {
      status: "cancelled",
      resolvedAt,
      reason: "target_unavailable",
      consequences: { standing: [], household: [], nation: {} },
      knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
    };
  }

  // Note: target carrying is NOT a cancellation reason (non-physical schemes)

  // 5. Compute success and discovery rolls
  const successThreshold = computeSuccessThreshold(db, state, plan);
  const discoveryThreshold = computeDiscoveryThreshold(db, state, plan);

  const successRoll = intrigueRoll(
    `harem_intrigue:success:${sourceKey}:${actorId}:${targetId}:${plan.kind}`,
  );
  const discoveryRoll = intrigueRoll(
    `harem_intrigue:discovery:${sourceKey}:${actorId}:${targetId}:${plan.kind}`,
  );

  const success = successRoll < successThreshold;
  const discovered = discoveryRoll < discoveryThreshold;

  const consequences = buildIntrigueConsequences(plan, success, discovered);

  return {
    status: "resolved",
    resolvedAt,
    successRoll,
    successThreshold,
    success,
    discoveryRoll,
    discoveryThreshold,
    discovered,
    consequences,
    knowledge: {
      actorKnowsOwnAction: true,
      targetKnowsInstigator: discovered,
      palacePublic: discovered,
    },
  };
}
