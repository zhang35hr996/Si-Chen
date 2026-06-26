/**
 * PUNISH-4C: Cross-link and invariant validation for ColdPalaceIncident records.
 * Called from gameStateSchema.superRefine() — validates persistent incident state.
 */
import { gameError, type GameError } from "../infra/errors";
import type { ColdPalaceEffect, GameState } from "../state/types";
import { coldPalaceIncidentId } from "./coldPalaceIncidents";

function incidentErr(msg: string): GameError {
  return gameError("state", "BAD_COLD_PALACE_INCIDENT", msg);
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

/** Parse canonical incident ID to { residentId, year, month } or null if malformed. */
function parseColdPalaceIncidentId(id: string): { residentId: string; year: number; month: number } | null {
  const match = id.match(/^cpi_(.+)_(\d+)_(\d{2})$/);
  if (!match) return null;
  const [, residentId, yearStr, monthStr] = match;
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
  return { residentId: residentId!, year, month };
}

export function validateColdPalaceIncidentLinks(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const { coldPalaceIncidents, statusEffects } = state;

  const seenIds = new Set<string>();
  const seenResidentMonth = new Map<string, string>(); // "charId:year:MM" → incidentId

  for (const incident of coldPalaceIncidents) {
    const { id, residentId, effectId, kind, occurredAt, healthDelta } = incident;

    // 1. Globally unique IDs.
    if (seenIds.has(id)) {
      errors.push(incidentErr(`ColdPalaceIncident id "${id}" is not unique`));
    }
    seenIds.add(id);

    // 2. ID matches canonical format cpi_{residentId}_{year}_{MM}.
    const parsed = parseColdPalaceIncidentId(id);
    if (!parsed) {
      errors.push(incidentErr(`ColdPalaceIncident id "${id}" does not match canonical format cpi_{residentId}_{year}_{MM}`));
    } else {
      const expectedId = coldPalaceIncidentId(parsed.residentId, parsed.year, parsed.month);
      if (id !== expectedId) {
        errors.push(incidentErr(`ColdPalaceIncident id "${id}" does not match canonical id "${expectedId}"`));
      }
      if (parsed.residentId !== residentId) {
        errors.push(incidentErr(`ColdPalaceIncident "${id}": id residentId "${parsed.residentId}" ≠ incident.residentId "${residentId}"`));
      }
      // 3. At most one per resident per month (by canonical ID uniqueness).
      const slotKey = `${residentId}:${parsed.year}:${padMonth(parsed.month)}`;
      if (seenResidentMonth.has(slotKey)) {
        errors.push(incidentErr(`ColdPalaceIncident duplicate resident/month: "${id}" and "${seenResidentMonth.get(slotKey)}"`));
      }
      seenResidentMonth.set(slotKey, id);
    }

    // 4. Linked effect exists and is kind=cold_palace.
    const linkedEffect = statusEffects.find((e): e is ColdPalaceEffect =>
      e.kind === "cold_palace" && e.id === effectId,
    );
    if (!linkedEffect) {
      errors.push(incidentErr(`ColdPalaceIncident "${id}": effectId "${effectId}" not found in statusEffects`));
    } else {
      // 5. effect.characterId === incident.residentId.
      if (linkedEffect.characterId !== residentId) {
        errors.push(incidentErr(
          `ColdPalaceIncident "${id}": effectId "${effectId}" belongs to "${linkedEffect.characterId}", not "${residentId}"`,
        ));
      }
      // 6. Effect was active at occurredAt.dayIndex (can be historical/lifted by now).
      // We only check startTurn — if effect started after the incident, something is wrong.
      if (linkedEffect.startTurn > occurredAt.dayIndex) {
        errors.push(incidentErr(
          `ColdPalaceIncident "${id}": effect "${effectId}" started at turn ${linkedEffect.startTurn} but incident occurredAt dayIndex ${occurredAt.dayIndex}`,
        ));
      }
    }

    // 7. petition must not carry healthDelta.
    if (kind === "petition" && healthDelta !== undefined) {
      errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=petition must not have healthDelta (got ${healthDelta})`));
    }

    // 8. health_deterioration must carry a valid negative delta.
    if (kind === "health_deterioration") {
      if (healthDelta === undefined) {
        errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=health_deterioration must have healthDelta`));
      } else if (healthDelta >= 0) {
        errors.push(incidentErr(`ColdPalaceIncident "${id}": healthDelta must be negative (got ${healthDelta})`));
      }
    }
  }

  return errors;
}
