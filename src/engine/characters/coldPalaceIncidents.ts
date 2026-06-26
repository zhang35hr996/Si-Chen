/**
 * PUNISH-4C/4D/4E: Cold-palace consequence incidents and player interventions.
 *
 * Design principles:
 *  - Pure functions; no side-effects; no Date.now() / Math.random().
 *  - IDs are deterministic compound keys → replay-stable, naturally idempotent.
 *  - At most ONE incident per planner per checkpoint (sorted by charId → first hit wins).
 *  - Regular health delta is non-lethal: cannot reduce health to 0.
 *  - Critical illness uses two-phase model: no health effect at tick time; effect at resolution.
 *  - Generated consorts supported via state.standing (no db.characters lookup needed).
 *  - Interventions: at most one per resident per month; guarded by canInterveneInColdPalace.
 */
import type {
  ColdPalaceIncident,
  ColdPalaceCriticalIllnessIncident,
  ColdPalaceIncidentKind,
  ColdPalaceEffect,
  ColdPalaceIntervention,
  ColdPalaceInterventionKind,
  GameState,
} from "../state/types";
import type { GameTime } from "../calendar/time";
import { activeColdPalaceEffectFor, isColdPalaceEffectActiveAt } from "./coldPalace";
import { gestationRoll } from "./gestation";

// ── ID helpers ──────────────────────────────────────────────────────────────

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

/** Deterministic id: "cpi_{residentId}_{year}_{MM}" — at most one per resident/month. */
export function coldPalaceIncidentId(charId: string, year: number, month: number): string {
  return `cpi_${charId}_${year}_${padMonth(month)}`;
}

// ── Selectors ───────────────────────────────────────────────────────────────

export function hasColdPalaceIncidentThisMonth(
  incidents: readonly ColdPalaceIncident[],
  charId: string,
  year: number,
  month: number,
): boolean {
  const id = coldPalaceIncidentId(charId, year, month);
  return incidents.some((i) => i.id === id);
}

export function pendingColdPalaceIncidents(
  incidents: readonly ColdPalaceIncident[],
): ColdPalaceIncident[] {
  return incidents.filter((i) => !i.acknowledged);
}

/** Oldest unacknowledged incident (by occurredAt year then month), or undefined. */
export function oldestPendingIncident(
  incidents: readonly ColdPalaceIncident[],
): ColdPalaceIncident | undefined {
  const pending = pendingColdPalaceIncidents(incidents);
  if (!pending.length) return undefined;
  return pending.reduce((a, b) => {
    const ordA = a.occurredAt.year * 12 + a.occurredAt.month;
    const ordB = b.occurredAt.year * 12 + b.occurredAt.month;
    return ordA <= ordB ? a : b;
  });
}

/**
 * Resolve the specific ColdPalaceEffect linked to an incident (by effectId).
 * Returns the effect even if it has since been lifted — presentable regardless.
 * Returns undefined only if the effect is not found or mismatched.
 */
export function resolveLinkedEffect(
  state: GameState,
  incident: ColdPalaceIncident,
): ColdPalaceEffect | undefined {
  return state.statusEffects.find(
    (e): e is ColdPalaceEffect =>
      e.kind === "cold_palace" &&
      e.id === incident.effectId &&
      e.characterId === incident.residentId,
  );
}

/** True iff the linked effect is still active (resident currently in cold palace under that effect). */
export function isLinkedEffectStillActive(
  state: GameState,
  incident: ColdPalaceIncident,
): boolean {
  const effect = resolveLinkedEffect(state, incident);
  if (!effect) return false;
  return isColdPalaceEffectActiveAt(effect, state.calendar.dayIndex);
}

/**
 * Presentation state for a single incident.
 * Used by App / settlement to determine whether to show a report or silently dismiss it.
 *
 * - "active"          resident still in cold palace under the linked effect
 * - "historical"      effect lifted but resident exists — report still displayable
 * - "stale_deceased"  resident has died — report should be silently acknowledged
 * - "stale_missing"   resident not found in standing at all — report should be silently acknowledged
 * - "invalid"         linked effect not found (data corruption)
 */
export type ColdPalaceIncidentPresentation =
  | "active"
  | "historical"
  | "stale_deceased"
  | "stale_missing"
  | "invalid";

export function resolveColdPalaceIncidentPresentation(
  state: GameState,
  incident: ColdPalaceIncident,
): ColdPalaceIncidentPresentation {
  const effect = resolveLinkedEffect(state, incident);
  if (!effect) return "invalid";

  const standing = state.standing[incident.residentId];
  if (!standing) return "stale_missing";
  if (standing.lifecycle === "deceased") return "stale_deceased";

  if (isLinkedEffectStillActive(state, incident)) return "active";
  return "historical";
}

/**
 * True if the incident should be shown as a global interrupt.
 * Stale (deceased/missing/invalid) reports must not block the queue.
 */
export function isIncidentPresentable(
  state: GameState,
  incident: ColdPalaceIncident,
): boolean {
  const presentation = resolveColdPalaceIncidentPresentation(state, incident);
  return presentation === "active" || presentation === "historical";
}

/**
 * Returns the oldest unacknowledged incident that is still presentable.
 * critical_illness (pending_response) is always prioritised over other kinds.
 */
export function oldestPresentableIncident(
  state: GameState,
): ColdPalaceIncident | undefined {
  const candidates = state.coldPalaceIncidents.filter(
    (i) => !i.acknowledged && isIncidentPresentable(state, i),
  );
  if (!candidates.length) return undefined;
  return candidates.reduce((a, b) => {
    const aUrgent = a.kind === "critical_illness" && a.status === "pending_response";
    const bUrgent = b.kind === "critical_illness" && b.status === "pending_response";
    if (aUrgent && !bUrgent) return a;
    if (!aUrgent && bUrgent) return b;
    const ordA = a.occurredAt.year * 12 + a.occurredAt.month;
    const ordB = b.occurredAt.year * 12 + b.occurredAt.month;
    return ordA <= ordB ? a : b;
  });
}

/**
 * Returns IDs of unacknowledged incidents that are stale and should be
 * silently auto-acknowledged. Called by settlePostAdvance to drain the queue.
 */
export function staleIncidentIds(state: GameState): string[] {
  return state.coldPalaceIncidents
    .filter((i) => {
      if (i.acknowledged) return false;
      const p = resolveColdPalaceIncidentPresentation(state, i);
      return p === "stale_deceased" || p === "stale_missing" || p === "invalid";
    })
    .map((i) => i.id);
}

// ── Scheduling constants ────────────────────────────────────────────────────

/** % chance an eligible resident generates a regular incident in a given month. */
const INCIDENT_CHANCE = 65;

/**
 * Health at or below this threshold: regular planner skips the resident;
 * critical-illness planner takes over instead.
 */
export const CRITICAL_HEALTH_THRESHOLD = 20;

/** % chance a critical-health resident generates a serious illness incident. */
const CRITICAL_ILLNESS_CHANCE = 60;

/** Health recovery applied by physician choice (via planHealthChange). */
export const PHYSICIAN_RECOVERY_DELTA = 15;

/** Raw health delta: -(5..10). */
function rawIncidentHealthDelta(rngSeed: number, charId: string, year: number, month: number): number {
  const roll = gestationRoll(`cpi:delta:${rngSeed}:${charId}:${year}:${month}`);
  return -(5 + (roll % 6));
}

/**
 * Non-lethal health delta: clamps so current health cannot reach 0.
 * Returns undefined (no health change) if resident is already at 1 HP.
 */
function nonLethalDelta(rawDelta: number, currentHealth: number): number | undefined {
  if (currentHealth <= 1) return undefined;
  const clamped = Math.max(rawDelta, -(currentHealth - 1));
  return clamped < 0 ? clamped : undefined;
}

function incidentKind(
  rngSeed: number,
  charId: string,
  year: number,
  month: number,
  health: number,
): ColdPalaceIncidentKind {
  // health > CRITICAL_HEALTH_THRESHOLD guaranteed by caller filter
  if (health < 50) return "health_deterioration";
  const roll = gestationRoll(`cpi:kind:${rngSeed}:${charId}:${year}:${month}`);
  return roll < 35 ? "health_deterioration" : "petition";
}

/**
 * Deterministic ignore-penalty delta at resolution time: -(10..25).
 * Can be lethal for residents at very low health.
 */
export function criticalIgnoreDelta(rngSeed: number, charId: string, year: number, month: number): number {
  const roll = gestationRoll(`cpci:ignore:${rngSeed}:${charId}:${year}:${month}`);
  return -(10 + (roll % 16));
}

// ── Planners ─────────────────────────────────────────────────────────────────

/**
 * Regular cold-palace incident planner (petition / health_deterioration).
 * Returns at most ONE new incident per call.
 *
 * Skips residents at health ≤ CRITICAL_HEALTH_THRESHOLD — they are handled
 * by planColdPalaceCriticalIncident instead.
 * Health deltas are non-lethal (cannot reduce health to 0).
 * Caller applies health delta via planHealthChange before committing.
 * Must be called only when monthChanged = true.
 */
export function planColdPalaceIncidents(state: GameState): ColdPalaceIncident[] {
  const { year, month, period, dayIndex } = state.calendar;
  const now: GameTime = { year, month, period, dayIndex };
  const rngSeed = state.rngSeed;

  const candidates = Object.entries(state.standing)
    .filter(([charId, standing]) => {
      if (standing.lifecycle === "deceased" || standing.lifecycle === "candidate") return false;
      const health = standing.health ?? 100;
      if (health <= CRITICAL_HEALTH_THRESHOLD) return false; // critical planner's domain
      if (hasColdPalaceIncidentThisMonth(state.coldPalaceIncidents, charId, year, month)) return false;
      return activeColdPalaceEffectFor(state, charId, dayIndex) !== undefined;
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [charId, standing] of candidates) {
    const roll = gestationRoll(`cpi:${rngSeed}:${charId}:${year}:${month}`);
    if (roll >= INCIDENT_CHANCE) continue;

    const effect = activeColdPalaceEffectFor(state, charId, dayIndex)!;
    const health = standing.health ?? 100;
    const kind = incidentKind(rngSeed, charId, year, month, health);

    let healthDelta: number | undefined;
    if (kind === "health_deterioration") {
      const raw = rawIncidentHealthDelta(rngSeed, charId, year, month);
      healthDelta = nonLethalDelta(raw, health);
    }

    const finalKind = healthDelta !== undefined ? kind : "petition";
    if (finalKind === "health_deterioration" && healthDelta !== undefined) {
      return [{
        id: coldPalaceIncidentId(charId, year, month),
        residentId: charId,
        effectId: effect.id,
        kind: "health_deterioration",
        occurredAt: now,
        acknowledged: false,
        healthDelta,
      }];
    }
    return [{
      id: coldPalaceIncidentId(charId, year, month),
      residentId: charId,
      effectId: effect.id,
      kind: "petition",
      occurredAt: now,
      acknowledged: false,
    }];
  }

  return [];
}

/**
 * Critical-illness planner (PUNISH-4D).
 * Returns at most ONE new critical_illness incident per call.
 *
 * Only targets residents at health ≤ CRITICAL_HEALTH_THRESHOLD.
 * Two-phase model: no health effect at tick time; player resolves later.
 * Must be called only when monthChanged = true, after planColdPalaceIncidents.
 */
export function planColdPalaceCriticalIncident(
  state: GameState,
): ColdPalaceCriticalIllnessIncident | null {
  const { year, month, period, dayIndex } = state.calendar;
  const now: GameTime = { year, month, period, dayIndex };
  const rngSeed = state.rngSeed;

  const candidates = Object.entries(state.standing)
    .filter(([charId, standing]) => {
      if (standing.lifecycle === "deceased" || standing.lifecycle === "candidate") return false;
      const health = standing.health ?? 100;
      if (health > CRITICAL_HEALTH_THRESHOLD) return false;
      if (hasColdPalaceIncidentThisMonth(state.coldPalaceIncidents, charId, year, month)) return false;
      // Skip if there is already an unresolved critical_illness (don't stack)
      const hasUnresolved = state.coldPalaceIncidents.some(
        (i) => i.residentId === charId && i.kind === "critical_illness" && !i.acknowledged,
      );
      if (hasUnresolved) return false;
      return activeColdPalaceEffectFor(state, charId, dayIndex) !== undefined;
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [charId] of candidates) {
    const roll = gestationRoll(`cpci:${rngSeed}:${charId}:${year}:${month}`);
    if (roll >= CRITICAL_ILLNESS_CHANCE) continue;

    const effect = activeColdPalaceEffectFor(state, charId, dayIndex)!;
    return {
      id: coldPalaceIncidentId(charId, year, month),
      residentId: charId,
      effectId: effect.id,
      kind: "critical_illness",
      occurredAt: now,
      acknowledged: false,
      status: "pending_response",
    };
  }

  return null;
}

// ── PUNISH-4E: Player intervention ──────────────────────────────────────────

/** AP cost deducted for any cold-palace intervention. */
export const COLD_PALACE_INTERVENTION_AP_COST = 1;
/** Favor awarded to resident by personal_visit. */
export const COLD_PALACE_VISIT_FAVOR_DELTA = 5;
/** Health restored to resident by physician intervention. */
export const COLD_PALACE_PHYSICIAN_HEALTH_DELTA = 10;

/** Deterministic ID: "cpa_{residentId}_{year}_{MM}" — at most one per resident/month. */
export function coldPalaceInterventionId(charId: string, year: number, month: number): string {
  return `cpa_${charId}_${year}_${padMonth(month)}`;
}

/** True iff the resident has already been visited/treated this calendar month. */
export function hasIntervenedThisMonth(
  interventions: readonly ColdPalaceIntervention[],
  charId: string,
  year: number,
  month: number,
): boolean {
  const id = coldPalaceInterventionId(charId, year, month);
  return interventions.some((i) => i.id === id);
}

/**
 * Eligibility check for a player intervention.
 *
 * Conditions:
 *  - Resident exists, not deceased/candidate.
 *  - Resident currently has an active cold-palace effect.
 *  - No intervention already recorded for this resident this month.
 *  - Player has ≥ 1 AP remaining.
 */
export function canInterveneInColdPalace(
  state: GameState,
  charId: string,
  _kind: ColdPalaceInterventionKind,
): boolean {
  const standing = state.standing[charId];
  if (!standing) return false;
  if (standing.lifecycle === "deceased" || standing.lifecycle === "candidate") return false;
  const { year, month, dayIndex } = state.calendar;
  if (activeColdPalaceEffectFor(state, charId, dayIndex) === undefined) return false;
  if (hasIntervenedThisMonth(state.coldPalaceInterventions, charId, year, month)) return false;
  if (state.calendar.ap < COLD_PALACE_INTERVENTION_AP_COST) return false;
  return true;
}

/**
 * Pure planner — returns an unattached ColdPalaceIntervention record.
 * The caller must validate eligibility via canInterveneInColdPalace before calling this.
 */
export function planColdPalaceIntervention(
  state: GameState,
  charId: string,
  kind: ColdPalaceInterventionKind,
): ColdPalaceIntervention {
  const { year, month, period, dayIndex } = state.calendar;
  const effect = activeColdPalaceEffectFor(state, charId, dayIndex)!;
  const occurredAt = { year, month, period, dayIndex };
  const id = coldPalaceInterventionId(charId, year, month);

  if (kind === "personal_visit") {
    return {
      id,
      residentId: charId,
      effectId: effect.id,
      kind: "personal_visit",
      occurredAt,
      favorDelta: COLD_PALACE_VISIT_FAVOR_DELTA,
    };
  }
  return {
    id,
    residentId: charId,
    effectId: effect.id,
    kind: "physician",
    occurredAt,
    healthDelta: COLD_PALACE_PHYSICIAN_HEALTH_DELTA,
  };
}
