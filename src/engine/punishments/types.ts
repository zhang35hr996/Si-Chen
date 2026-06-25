/**
 * Core types for the punishment consequence system (PUNISH-2).
 *
 * ReactionBeat is the shared shape for all reaction-screen entries —
 * PunishmentConsequencePlan uses it, and DecreeReaction in empressDecree.ts
 * is an alias for the same shape.
 */
import type { EventEffect } from "../content/schemas";
import type { CourtEvent } from "../state/types";

// ── Shared reaction beat ──────────────────────────────────────────────────────

export interface ReactionBeat {
  speakerId: string;
  lines: string[];
  backgroundKey?: string;
}

// ── Punishment classification ─────────────────────────────────────────────────

export type PunishmentKind =
  | "rank_demotion"
  | "strip_title"
  | "finite_confinement"
  | "indefinite_confinement"
  | "cold_palace"
  | "execution"
  | "strip_harem_authority";

/**
 * 官员目标的惩戒种类（Phase 3 PR3C-3a）。与侍君 PunishmentKind 分立——官员后果走独立 planner
 * （忠心/家族皇恩），**绝不**经侍君属性后果。两者皆即时完成（completed）。
 */
export type OfficialPunishmentKind = "official_demotion" | "official_dismissal";

export type PunishmentSeverity = "minor" | "moderate" | "severe" | "terminal";

/** 官员惩戒严重度（降职=中度；免官=重度）。 */
export function officialPunishmentSeverity(kind: OfficialPunishmentKind): PunishmentSeverity {
  return kind === "official_dismissal" ? "severe" : "moderate";
}

/** Severity derived from PunishmentKind. Used by personality modifiers and consequence planner. */
export function punishmentSeverity(kind: PunishmentKind): PunishmentSeverity {
  switch (kind) {
    case "strip_title": return "minor";
    case "rank_demotion": return "moderate";
    case "finite_confinement": return "moderate";
    case "strip_harem_authority": return "moderate";
    case "indefinite_confinement": return "severe";
    case "cold_palace": return "severe";
    case "execution": return "terminal";
    case "strip_harem_authority": return "moderate";
  }
}

// ── Context passed to the consequence planner ────────────────────────────────

/**
 * Full context used internally by planPunishmentConsequences.
 * Callers of the GameStore entry points (applyImperialPunishmentWithConsequences /
 * applyPunitiveRankChangeWithConsequences) supply only PunishmentMeta; the store
 * derives targetId / kind / severity / occurredAt from the validated command.
 */
export interface PunishmentOutcomeContext {
  /** Stable ID for this punishment event (used as RNG seed component). */
  punishmentId: string;
  /** Optional case reference (PUNISH-3A will validate this exists in state). */
  caseId?: string;
  targetId: string;
  actorId: "player";
  kind: PunishmentKind;
  severity: PunishmentSeverity;
  occurredAt: import("../calendar/time").GameTime;
  sourceLocation?: string;
  /** Publicity of the case; affects what other consorts can react to. */
  publicity?: "secret" | "palace" | "public";
}

/**
 * Minimal caller-supplied metadata for the GameStore punitive entry points.
 * targetId / kind / severity / occurredAt / punishmentId are all derived
 * internally — the caller must NOT supply punishmentId to ensure uniqueness.
 */
export interface PunishmentMeta {
  caseId?: string;
  publicity?: "secret" | "palace" | "public";
  sourceLocation?: string;
}

// ── Consequence plan returned by the planner ─────────────────────────────────

export interface PunishmentConsequencePlan {
  /** Attribute effects for the target and other consorts (adjust_consort_attr + memory). */
  effects: EventEffect[];
  /** Chronicle drafts to append alongside the base command's chronicle. */
  chronicle: Omit<CourtEvent, "id">[];
  /** Up to 3 visible reaction beats for the UI reactionQueue. */
  reactionBeats: ReactionBeat[];
}

// ── Reaction classification for other consorts ───────────────────────────────

export type PunishmentReactionKind =
  | "sympathy"
  | "fear"
  | "schadenfreude"
  | "anger"
  | "warning"
  | "opportunism"
  | "plead_intent"
  | "revenge_intent";
