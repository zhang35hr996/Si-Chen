/**
 * Pure consequence planner for PUNISH-2.
 *
 * planPunishmentConsequences() is a pure function (no state mutations).
 * It computes:
 *   - adjust_consort_attr effects for the target (affection, fear, ambition,
 *     loyalty, health via set_consort_health)
 *   - memory effects for the target
 *   - other-consort reaction effects + memory (delegated to otherConsortsReaction)
 *   - up to 3 visible ReactionBeats for the UI
 *
 * All rolls use gestationRoll (FNV-1a seeded) to guarantee determinism.
 */
import { gestationRoll } from "../characters/gestation";
import type { ContentDB } from "../content/loader";
import type { EventEffect } from "../content/schemas";
import type { CourtEvent, GameState } from "../state/types";
import { evaluateOtherConsortReactions } from "./otherConsortsReaction";
import { getPersonalityModifier } from "./personalityModifiers";
import type { PunishmentConsequencePlan, PunishmentKind, PunishmentOutcomeContext } from "./types";

// ── Seeded roll ───────────────────────────────────────────────────────────────

function punishmentRoll(punishmentId: string, targetId: string, tag: string, min: number, max: number): number {
  const seed = `punish:${punishmentId}:${targetId}:${tag}`;
  const raw = gestationRoll(seed);
  return min + (raw % (max - min + 1));
}

// ── Baseline delta tables (negative = decrease, positive = increase) ──────────

type BaselineRange = [min: number, max: number];

// Per PunishmentKind: [affectionDelta min, max] [fearDelta min, max] [loyaltyDelta min, max] [healthDelta min, max]
// Following the spec tables (all negative affection/loyalty, positive fear)
const BASELINES: Record<PunishmentKind, {
  affection: BaselineRange;
  fear: BaselineRange;
  loyalty: BaselineRange;
  health: BaselineRange;
}> = {
  strip_title:           { affection: [-6, -3],   fear: [3, 8],    loyalty: [-4, -1],  health: [0, 0] },
  rank_demotion:         { affection: [-10, -5],  fear: [5, 12],   loyalty: [-6, -2],  health: [0, 0] },
  finite_confinement:    { affection: [-15, -8],  fear: [10, 20],  loyalty: [-8, -3],  health: [-2, 0] },
  indefinite_confinement:{ affection: [-25, -15], fear: [20, 35],  loyalty: [-15, -8], health: [-4, -1] },
  cold_palace:           { affection: [-40, -25], fear: [25, 45],  loyalty: [-30, -15],health: [-8, -3] },
  strip_harem_authority: { affection: [-8, -4],   fear: [5, 12],   loyalty: [-6, -2],  health: [0, 0] },
  execution:             { affection: [0, 0],     fear: [0, 0],    loyalty: [0, 0],    health: [0, 0] }, // death pipeline handles
};


// ── Target effect builder ─────────────────────────────────────────────────────

function buildTargetEffects(
  db: ContentDB,
  state: GameState,
  ctx: PunishmentOutcomeContext,
): EventEffect[] {
  // execution has no attribute consequence (target enters death pipeline)
  if (ctx.kind === "execution") return [];

  const baseline = BASELINES[ctx.kind];
  if (!baseline) return [];

  const char = db.characters[ctx.targetId] ?? state.generatedConsorts[ctx.targetId];
  const traits = char?.kind === "consort" ? (char.profile.reactionTraits ?? []) : [];
  const mod = getPersonalityModifier(traits, ctx.severity);

  // Health extra for sick/critical consorts under severe punishment
  const healthStatus = state.standing[ctx.targetId]?.healthStatus;
  const sicknessHealthPenalty = (ctx.severity === "severe" || ctx.severity === "terminal")
    && (healthStatus === "sick" || healthStatus === "critical")
    ? punishmentRoll(ctx.punishmentId, ctx.targetId, "health_sick", -6, -3)
    : 0;

  // Raw deltas (pre-modifier)
  const rawAffection = punishmentRoll(ctx.punishmentId, ctx.targetId, "aff", baseline.affection[0], baseline.affection[1]);
  const rawFear      = punishmentRoll(ctx.punishmentId, ctx.targetId, "fear", baseline.fear[0], baseline.fear[1]);
  const rawLoyalty   = punishmentRoll(ctx.punishmentId, ctx.targetId, "loy", baseline.loyalty[0], baseline.loyalty[1]);
  const rawHealth    = punishmentRoll(ctx.punishmentId, ctx.targetId, "hp",  baseline.health[0], baseline.health[1]);

  // Apply personality multipliers + flat adds
  const affectionDelta = Math.round(rawAffection * mod.affectionMul);
  const fearDelta      = Math.round(rawFear * mod.fearMul);
  const loyaltyDelta   = rawLoyalty + mod.loyaltyDeltaAdd;
  const ambitionDelta  = mod.ambitionDeltaAdd;
  const healthDelta    = rawHealth + sicknessHealthPenalty;

  const effects: EventEffect[] = [];

  if (affectionDelta !== 0) {
    effects.push({ type: "adjust_consort_attr", char: ctx.targetId, field: "affection", delta: affectionDelta });
  }
  if (fearDelta !== 0) {
    effects.push({ type: "adjust_consort_attr", char: ctx.targetId, field: "fear",      delta: fearDelta });
  }
  if (loyaltyDelta !== 0) {
    effects.push({ type: "adjust_consort_attr", char: ctx.targetId, field: "loyalty",   delta: loyaltyDelta });
  }
  if (ambitionDelta !== 0) {
    effects.push({ type: "adjust_consort_attr", char: ctx.targetId, field: "ambition",  delta: ambitionDelta });
  }
  if (healthDelta !== 0) {
    effects.push({ type: "set_consort_health", char: ctx.targetId, healthDelta });
  }

  // Target memory is written by the base command (imperialCommands / buildRankOp);
  // the consequence planner must NOT add a second memory to avoid duplicates.

  return effects;
}

// ── Chronicle draft ───────────────────────────────────────────────────────────

function buildConsequenceChronicle(
  ctx: PunishmentOutcomeContext,
): Omit<CourtEvent, "id">[] {
  // The base command already writes the main punishment chronicle entry.
  // The consequence planner only adds a second entry when there are notable
  // secondary effects (e.g. other consorts reacted).
  // For now: return empty; other-consort reactions write their own memory effects.
  // A dedicated chronicle entry can be added in future PRs.
  void ctx;
  return [];
}

// ── Main planner ──────────────────────────────────────────────────────────────

export function planPunishmentConsequences(
  db: ContentDB,
  state: GameState,
  ctx: PunishmentOutcomeContext,
): PunishmentConsequencePlan {
  const targetEffects = buildTargetEffects(db, state, ctx);
  const { otherEffects, reactionBeats } = evaluateOtherConsortReactions(db, state, ctx);
  const chronicle = buildConsequenceChronicle(ctx);

  return {
    effects: [...targetEffects, ...otherEffects],
    chronicle,
    reactionBeats,
  };
}
