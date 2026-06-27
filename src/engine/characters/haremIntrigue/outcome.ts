import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";
import type { GameTime } from "../../calendar/time";
import { fnv1a64Hex } from "../../save/canonical";
import { resolveConsortRuntimeAttrs } from "../consortAttrs";
import { buildHaremRankLadder, computeRankRivalry } from "./scoring";
import { checkIntrigueActorEligibility, checkIntrigueTargetEligibility } from "./eligibility";
import { validateHaremIntriguePlan } from "./validation";
import { buildIntrigueConsequences } from "./consequences";
import type {
  HaremIntriguePlan,
  HaremIntrigueOutcome,
} from "./types";

// Re-export for backward compatibility (tests import it from here)
export { buildIntrigueConsequences } from "./consequences";

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

  // Rank protection: use ladder index gap (same helper as rankRivalry in scoring)
  let rankProtection = 0;
  if (actorRank && targetRank) {
    const ladder = buildHaremRankLadder(db);
    const actorRankId = actorStanding?.rank ?? "";
    const targetRankId = targetStanding?.rank ?? "";
    rankProtection = clamp(
      computeRankRivalry(actorRankId, targetRankId, ladder),
      0,
      100,
    );
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

/** Convenience factory for cancelled outcomes. */
function cancelled(
  resolvedAt: GameTime,
  reason: HaremIntriguePlan extends never ? never : "actor_unavailable" | "target_unavailable" | "actor_target_same" | "plan_invalid",
): HaremIntrigueOutcome {
  return {
    status: "cancelled",
    resolvedAt,
    reason,
    consequences: { standing: [], household: [], nation: {} },
    knowledge: { actorKnowsOwnAction: true, targetKnowsInstigator: false, palacePublic: false },
  };
}

/**
 * Resolve a planned intrigue scheme at execution time.
 * Validates plan fully, re-checks eligibility, uses current state for resistance/discovery.
 */
export function resolveIntrigueOutcome(
  db: ContentDB,
  state: GameState,
  plan: HaremIntriguePlan,
  resolvedAt: GameTime,
): HaremIntrigueOutcome {
  // 1. Full plan validation (replaces old isPlanResoluble weak check)
  const findings = validateHaremIntriguePlan(plan);
  if (findings.length > 0) {
    return cancelled(resolvedAt, "plan_invalid");
  }

  const { actorId, targetId, sourceKey } = plan;

  // 2. Self-target sanity (also caught by validator, but explicit here for cancelled reason)
  if (actorId === targetId) {
    return cancelled(resolvedAt, "actor_target_same");
  }

  // 3. Runtime actor eligibility re-check (skipping propensity threshold)
  const actorCheck = checkIntrigueActorEligibility(db, state, actorId, resolvedAt);
  if (!actorCheck.eligible) {
    return cancelled(resolvedAt, "actor_unavailable");
  }

  // 4. Runtime target eligibility re-check
  const targetCheck = checkIntrigueTargetEligibility(db, state, targetId);
  if (!targetCheck.eligible) {
    return cancelled(resolvedAt, "target_unavailable");
  }

  // 5. Compute success and discovery rolls (deterministic, seeded by rngSeed)
  const rngSeed = state.rngSeed;
  const successThreshold = computeSuccessThreshold(db, state, plan);
  const discoveryThreshold = computeDiscoveryThreshold(db, state, plan);

  const successRoll = intrigueRoll(
    `harem_intrigue:success:${rngSeed}:${sourceKey}:${actorId}:${targetId}:${plan.kind}`,
  );
  const discoveryRoll = intrigueRoll(
    `harem_intrigue:discovery:${rngSeed}:${sourceKey}:${actorId}:${targetId}:${plan.kind}`,
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
