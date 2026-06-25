/**
 * PUNISH-4C: Cold-palace consequence incidents — scheduling and selectors.
 *
 * Design principles:
 *  - Pure functions; no side-effects; no Date.now() / Math.random().
 *  - IDs are deterministic compound keys → replay-stable, naturally idempotent.
 *  - One incident per resident per month (at most).
 *  - Generated consorts supported via state.standing (no db.characters lookup needed).
 */
import type { ColdPalaceIncident, ColdPalaceIncidentKind, GameState } from "../state/types";
import type { GameTime } from "../calendar/time";
import { activeColdPalaceEffectFor } from "./coldPalace";
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

// ── Scheduling constants ────────────────────────────────────────────────────

/** % chance an eligible resident generates an incident in a given month. */
const INCIDENT_CHANCE = 65;

/** Health delta for health_deterioration incidents: -(5..10). */
function incidentHealthDelta(rngSeed: number, charId: string, year: number, month: number): number {
  const roll = gestationRoll(`cpi:delta:${rngSeed}:${charId}:${year}:${month}`);
  return -(5 + (roll % 6));
}

function incidentKind(
  rngSeed: number,
  charId: string,
  year: number,
  month: number,
  health: number,
): ColdPalaceIncidentKind {
  if (health < 50) return "health_deterioration";
  const roll = gestationRoll(`cpi:kind:${rngSeed}:${charId}:${year}:${month}`);
  return roll < 35 ? "health_deterioration" : "petition";
}

// ── Planner ─────────────────────────────────────────────────────────────────

/**
 * Pure planner: returns new ColdPalaceIncidents to append this month-tick.
 * Caller is responsible for applying health deltas via applyEffects before committing.
 * Must be called only when monthChanged = true (caller's responsibility).
 */
export function planColdPalaceIncidents(state: GameState): ColdPalaceIncident[] {
  const { year, month, period, dayIndex } = state.calendar;
  const now: GameTime = { year, month, period, dayIndex };
  const rngSeed = state.rngSeed;
  const newIncidents: ColdPalaceIncident[] = [];

  for (const [charId, standing] of Object.entries(state.standing)) {
    if (standing.lifecycle === "deceased" || standing.lifecycle === "candidate") continue;
    if (!activeColdPalaceEffectFor(state, charId, dayIndex)) continue;
    if (hasColdPalaceIncidentThisMonth(state.coldPalaceIncidents, charId, year, month)) continue;

    const roll = gestationRoll(`cpi:${rngSeed}:${charId}:${year}:${month}`);
    if (roll >= INCIDENT_CHANCE) continue;

    const effect = activeColdPalaceEffectFor(state, charId, dayIndex)!;
    const health = standing.health ?? 100;
    const kind = incidentKind(rngSeed, charId, year, month, health);
    const healthDelta = kind === "health_deterioration"
      ? incidentHealthDelta(rngSeed, charId, year, month)
      : undefined;

    newIncidents.push({
      id: coldPalaceIncidentId(charId, year, month),
      residentId: charId,
      effectId: effect.id,
      kind,
      occurredAt: now,
      acknowledged: false,
      ...(healthDelta !== undefined ? { healthDelta } : {}),
    });
  }

  return newIncidents;
}
