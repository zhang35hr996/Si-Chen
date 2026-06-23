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
import type { PunishmentConsequencePlan, PunishmentOutcomeContext } from "./types";

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
const BASELINES: Record<string, {
  affection: BaselineRange;
  fear: BaselineRange;
  loyalty: BaselineRange;
  health: BaselineRange;
}> = {
  strip_title:          { affection: [-6, -3],   fear: [3, 8],    loyalty: [-4, -1], health: [0, 0] },
  rank_demotion:        { affection: [-10, -5],  fear: [5, 12],   loyalty: [-6, -2], health: [0, 0] },
  finite_confinement:   { affection: [-15, -8],  fear: [10, 20],  loyalty: [-8, -3], health: [-2, 0] },
  indefinite_confinement:{ affection: [-25, -15], fear: [20, 35], loyalty: [-15, -8],health: [-4, -1] },
  cold_palace:          { affection: [-40, -25], fear: [25, 45],  loyalty: [-30, -15],health: [-8, -3] },
  execution:            { affection: [0, 0],     fear: [0, 0],    loyalty: [0, 0],   health: [0, 0] }, // death pipeline handles
};

function clamp(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

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
    effects.push({ type: "adjust_consort_attr", char: ctx.targetId, field: "loyalty",   delta: clamp(loyaltyDelta) - 100 > 50 ? loyaltyDelta : loyaltyDelta });
  }
  if (ambitionDelta !== 0) {
    effects.push({ type: "adjust_consort_attr", char: ctx.targetId, field: "ambition",  delta: ambitionDelta });
  }
  if (healthDelta !== 0) {
    effects.push({ type: "set_consort_health", char: ctx.targetId, healthDelta });
  }

  // Target memory
  // attrs available for future memory content personalisation
  const memoryKind = ctx.kind === "strip_title" || ctx.kind === "rank_demotion" ? "grievance" : "trauma";
  const memoryStrength = ctx.severity === "terminal" ? 100 : ctx.severity === "severe" ? 85 : ctx.severity === "moderate" ? 70 : 55;
  const memoryText = targetMemoryText(ctx.kind);

  effects.push({
    type: "memory",
    char: ctx.targetId,
    entry: {
      kind: memoryKind,
      summary: memoryText,
      strength: memoryStrength,
      retention: ctx.severity === "severe" || ctx.severity === "terminal" ? "permanent" : "slow",
      subjectIds: ["player", ctx.targetId],
      perspective: "target",
      triggerTags: ["punishment", ctx.kind, "player"],
      unresolved: true,
      emotions: emotionsForKind(ctx.kind),
    },
  });

  return effects;
}

function targetMemoryText(kind: string): string {
  switch (kind) {
    case "strip_title":           return "陛下下令褫夺我封号，此事刻骨难忘。";
    case "rank_demotion":         return "陛下降我位分，昔日风光已成过往。";
    case "finite_confinement":    return "陛下令我禁足，我困于宫室，不知何日方休。";
    case "indefinite_confinement":return "陛下命我无诏不得出，此禁令如同囚笼。";
    case "cold_palace":           return "陛下将我打入冷宫，废为庶人，往日一切已成空。";
    case "execution":             return ""; // death pipeline handles memory
    default:                      return "陛下降旨处分，我铭记于心。";
  }
}

function emotionsForKind(kind: string): Partial<Record<string, number>> {
  switch (kind) {
    case "strip_title":           return { shame: 40, grief: 20 };
    case "rank_demotion":         return { shame: 50, grief: 30 };
    case "finite_confinement":    return { fear: 50, grief: 30 };
    case "indefinite_confinement":return { fear: 65, grief: 40 };
    case "cold_palace":           return { fear: 70, grief: 60, anger: 20 };
    default:                      return { fear: 40 };
  }
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
