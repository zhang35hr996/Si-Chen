/**
 * Evaluates how other consorts react to a punishment event.
 *
 * Rules:
 *  - Only alive, non-deceased consorts with standing are considered.
 *  - All consorts get lightweight attribute/memory effects regardless of whether
 *    they appear as a visible reaction beat.
 *  - Visible beats: top 3 by deterministic score; never leak non-public case info.
 *  - discreet trait: reactionVisibilityMul ≈ 0.35 (usually not visible);
 *    but severe punishment or same-faction overrides can still bring them in.
 */
import { gestationRoll } from "../characters/gestation";
import { resolveConsortRuntimeAttrs } from "../characters/consortAttrs";
import { sameHaremFaction } from "../characters/factionSelectors";
import { isConfined } from "../characters/confinement";
import type { ContentDB } from "../content/loader";
import type { EventEffect } from "../content/schemas";
import type { GameState } from "../state/types";
import { getPersonalityModifier } from "./personalityModifiers";
import type { PunishmentOutcomeContext, PunishmentReactionKind, ReactionBeat } from "./types";

// ── Stance to base relation score ─────────────────────────────────────────────

const STANCE_CLOSENESS: Record<string, number> = {
  devoted: 90,
  friendly: 60,
  neutral: 20,
  competitive: -10,
  contemptuous: -30,
  hostile: -65,
};

function getStanceCloseness(db: ContentDB, state: GameState, charId: string, targetId: string): number {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  if (!char || char.kind !== "consort") return 20;
  const stance = char.stances?.find((s) => s.charId === targetId);
  return stance ? (STANCE_CLOSENESS[stance.stance] ?? 20) : 20;
}

function getStance(db: ContentDB, state: GameState, charId: string, targetId: string): string {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  if (!char || char.kind !== "consort") return "neutral";
  return char.stances?.find((s) => s.charId === targetId)?.stance ?? "neutral";
}

// ── Reaction kind classification ──────────────────────────────────────────────

function classifyReaction(
  closeness: number,
  stance: string,
  attrs: ReturnType<typeof resolveConsortRuntimeAttrs>,
  isSameFaction: boolean,
  severity: string,
): PunishmentReactionKind {
  if (closeness >= 60 || isSameFaction) {
    // Close ally or same faction — sympathise or plan to speak up
    if (attrs.loyalty > 70) return "sympathy";
    if (attrs.ambition > 60 && (severity === "severe" || severity === "terminal")) return "revenge_intent";
    return "plead_intent";
  }
  if (stance === "hostile" || stance === "contemptuous") {
    return attrs.ambition > 55 ? "schadenfreude" : "opportunism";
  }
  if (stance === "competitive") {
    return "opportunism";
  }
  // Neutral or lightly friendly — mainly fear or generic reaction
  if (attrs.fear < 40) return "warning";
  return "fear";
}

// ── Attribute effect for a bystander ─────────────────────────────────────────

function bystanterEffects(
  charId: string,
  reactionKind: PunishmentReactionKind,
  isSameFaction: boolean,
  attrs: ReturnType<typeof resolveConsortRuntimeAttrs>,
): EventEffect[] {
  const effects: EventEffect[] = [];
  switch (reactionKind) {
    case "fear":
      effects.push({ type: "adjust_consort_attr", char: charId, field: "fear", delta: 3 });
      break;
    case "sympathy":
      // Loyal friend to target: slight affection drop toward emperor
      if (attrs.loyalty > 50) {
        effects.push({ type: "adjust_consort_attr", char: charId, field: "affection", delta: -2 });
        effects.push({ type: "adjust_consort_attr", char: charId, field: "loyalty",   delta: -1 });
      }
      break;
    case "schadenfreude":
      effects.push({ type: "adjust_consort_attr", char: charId, field: "ambition", delta: 2 });
      break;
    case "opportunism":
      effects.push({ type: "adjust_consort_attr", char: charId, field: "ambition", delta: 3 });
      break;
    case "anger":
      if (isSameFaction) {
        effects.push({ type: "adjust_consort_attr", char: charId, field: "loyalty",   delta: -2 });
        effects.push({ type: "adjust_consort_attr", char: charId, field: "affection", delta: -3 });
      }
      break;
    case "plead_intent":
      // Plans to petition; no immediate attribute change
      break;
    case "revenge_intent":
      effects.push({ type: "adjust_consort_attr", char: charId, field: "ambition", delta: 4 });
      effects.push({ type: "adjust_consort_attr", char: charId, field: "loyalty",  delta: -3 });
      break;
    case "warning":
      effects.push({ type: "adjust_consort_attr", char: charId, field: "fear", delta: 2 });
      break;
  }
  return effects;
}

// ── Bystander memory summary ──────────────────────────────────────────────────

function bystanterMemorySummary(reactionKind: PunishmentReactionKind, publicity: string): string {
  // secret hides the crime/evidence, NOT the target's identity.
  const what = publicity === "secret"
    ? "某侍君突然受罚，缘由未明。"
    : "宫中有人因事获罪受罚。";

  switch (reactionKind) {
    case "fear":         return `${what}此事令人惶恐。`;
    case "sympathy":     return `${what}我心中颇感不忍。`;
    case "schadenfreude":return `${what}此人平素与我不睦，难言滋味。`;
    case "opportunism":  return `${what}或许是个机会。`;
    case "anger":        return `${what}此事令人愤慨。`;
    case "plead_intent": return `${what}我有意为其求情。`;
    case "revenge_intent":return `${what}我心中已有打算。`;
    case "warning":      return `${what}我须引以为戒。`;
  }
}

// ── Visible reaction lines ────────────────────────────────────────────────────

const REACTION_LINES: Record<PunishmentReactionKind, string[]> = {
  fear:           ["……侍身知道了。", "是，侍身明白了。"],
  sympathy:       ["……侍身惶恐，不敢多言。"],
  schadenfreude:  ["此事……侍身不便置喙。"],
  opportunism:    ["侍身谨记陛下圣威。"],
  anger:          ["……臣侍领旨。"],
  warning:        ["侍身定当谨言慎行。"],
  plead_intent:   ["……侍身有一事，或可斗胆一言。"],
  revenge_intent: ["……是。"],
};

function visibleLines(reactionKind: PunishmentReactionKind): string[] {
  return REACTION_LINES[reactionKind];
}

// ── Deterministic score for sorting / top-3 selection ────────────────────────

function reactionScore(
  charId: string,
  closeness: number,
  reactionKind: PunishmentReactionKind,
  isSameFaction: boolean,
  severity: string,
  visibilityMul: number,
  ranking: number,  // rank order from high to low (higher rank → lower number → higher priority)
): number {
  const intensityBonus: Record<PunishmentReactionKind, number> = {
    revenge_intent: 40,
    anger: 35,
    plead_intent: 30,
    sympathy: 25,
    opportunism: 20,
    schadenfreude: 15,
    warning: 10,
    fear: 5,
  };
  const severityBonus = severity === "terminal" ? 15 : severity === "severe" ? 10 : severity === "moderate" ? 5 : 0;
  const factionBonus  = isSameFaction ? 15 : 0;

  const rawScore = Math.abs(closeness) + intensityBonus[reactionKind] + severityBonus + factionBonus
    - ranking * 0.1  // rank tie-break
    + charId.charCodeAt(0) * 0.001; // id tie-break for stability

  return rawScore * visibilityMul;
}

// ── Main evaluator ────────────────────────────────────────────────────────────

export function evaluateOtherConsortReactions(
  db: ContentDB,
  state: GameState,
  ctx: PunishmentOutcomeContext,
): { otherEffects: EventEffect[]; reactionBeats: ReactionBeat[] } {
  const otherEffects: EventEffect[] = [];
  const publicity = ctx.publicity ?? "palace";

  interface Candidate {
    charId: string;
    score: number;
    reactionKind: PunishmentReactionKind;
  }
  const candidates: Candidate[] = [];

  // Deterministic seed for tie-breaking across consorts
  const batchSeed = gestationRoll(`punish_bystander:${ctx.punishmentId}`);
  void batchSeed;

  const allConsortIds = [
    ...Object.keys(db.characters).filter((id) => db.characters[id]!.kind === "consort"),
    ...Object.keys(state.generatedConsorts),
  ];
  const seen = new Set<string>();

  // Stable ordering before scoring: alphabetical by charId
  const orderedIds = [...new Set(allConsortIds)].sort();

  // Track rank order for tie-breaking (lower order number = higher rank)
  const rankOrders: Record<string, number> = {};
  let rankIdx = 0;
  for (const id of orderedIds) {
    const standing = state.standing[id];
    if (!standing) continue;
    const rank = db.ranks[standing.rank];
    rankOrders[id] = rank ? -(rank.order) : rankIdx;
    rankIdx++;
  }

  for (const charId of orderedIds) {
    if (seen.has(charId)) continue;
    seen.add(charId);

    if (charId === ctx.targetId) continue;

    const standing = state.standing[charId];
    if (!standing) continue;
    if (standing.lifecycle === "deceased") continue;
    if (isConfined(state, charId)) continue;

    const char = db.characters[charId] ?? state.generatedConsorts[charId];
    if (!char || char.kind !== "consort") continue;

    const attrs     = resolveConsortRuntimeAttrs(db, state, charId);
    const closeness = getStanceCloseness(db, state, charId, ctx.targetId);
    const stance    = getStance(db, state, charId, ctx.targetId);
    const isSameFaction = sameHaremFaction(state, charId, ctx.targetId);
    const traits    = char.profile.reactionTraits ?? [];
    const mod       = getPersonalityModifier(traits, ctx.severity);
    const reactionKind = classifyReaction(closeness, stance, attrs, isSameFaction, ctx.severity);

    // Attribute + memory effects for ALL qualifying bystanders
    const bEffects = bystanterEffects(charId, reactionKind, isSameFaction, attrs);
    otherEffects.push(...bEffects);

    otherEffects.push({
      type: "memory",
      char: charId,
      entry: {
        kind: "episodic",
        summary: bystanterMemorySummary(reactionKind, publicity),
        strength: ctx.severity === "severe" || ctx.severity === "terminal" ? 60 : 40,
        retention: "fast",
        subjectIds: ["player", ctx.targetId],
        perspective: "witness",
        triggerTags: ["punishment", ctx.kind],
        unresolved: reactionKind === "plead_intent" || reactionKind === "revenge_intent",
        emotions: reactionKind === "fear" || reactionKind === "warning" ? { fear: 30 }
          : reactionKind === "sympathy" ? { grief: 25 }
          : reactionKind === "schadenfreude" || reactionKind === "opportunism" ? { envy: 20 }
          : {},
      },
    });

    // discreet: boost visibility score for severe+same-faction even with low base mul
    const severityBoost = (ctx.severity === "severe" || ctx.severity === "terminal") && isSameFaction ? 2.0 : 1.0;
    const score = reactionScore(
      charId,
      closeness,
      reactionKind,
      isSameFaction,
      ctx.severity,
      mod.reactionVisibilityMul * severityBoost,
      rankOrders[charId] ?? 0,
    );

    candidates.push({ charId, score, reactionKind });
  }

  // Sort descending by score, then stable by charId for determinism
  candidates.sort((a, b) => b.score - a.score || a.charId.localeCompare(b.charId));

  const top3 = candidates.slice(0, 3);
  const reactionBeats: ReactionBeat[] = top3.map(({ charId, reactionKind }) => ({
    speakerId: charId,
    lines: visibleLines(reactionKind),
  }));

  return { otherEffects, reactionBeats };
}
