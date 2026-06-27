import type {
  HaremIntriguePlan,
  HaremIntrigueConsequencePlan,
  IntrigueStandingDelta,
  IntrigueHouseholdDelta,
  IntrigueNationDelta,
} from "./types";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Build consequence plan for a resolved outcome.
 * Merges deltas per character, removes zero values.
 * Extracted to break circular dependency: validation.ts → consequences.ts ← outcome.ts
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
