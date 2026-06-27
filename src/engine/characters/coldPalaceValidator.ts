/**
 * PUNISH-4C/4E: Cross-link and invariant validation for ColdPalaceIncident and
 * ColdPalaceIntervention records.
 * Called from gameStateSchema.superRefine() — validates persistent state.
 */
import { gameError, type GameError } from "../infra/errors";
import type { ColdPalaceEffect, ColdPalaceMadnessEffect, ColdPalaceMentalBreakdownIncident, GameState } from "../state/types";
import { isColdPalaceEffectActiveAt, wasColdPalaceEffectActiveForHistoricalEvent } from "./coldPalace";
import { coldPalaceIncidentId, coldPalaceInterventionId } from "./coldPalaceIncidents";

function incidentErr(msg: string): GameError {
  return gameError("state", "BAD_COLD_PALACE_INCIDENT", msg);
}

function interventionErr(msg: string): GameError {
  return gameError("state", "BAD_COLD_PALACE_INTERVENTION", msg);
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
    const { id, residentId, effectId, kind, occurredAt } = incident;

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
      // 2b. ID year/month must align with occurredAt.year/month.
      if (parsed.year !== occurredAt.year || parsed.month !== occurredAt.month) {
        errors.push(incidentErr(
          `ColdPalaceIncident "${id}": canonical id slot ${parsed.year}-${padMonth(parsed.month)} ≠ occurredAt ${occurredAt.year}-${padMonth(occurredAt.month)}`,
        ));
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
      // 6. Effect was active at occurredAt.dayIndex. Uses historical helper to allow
      //    same-day death-lift (liftReason==="death" && liftedTurn===occurredAt.dayIndex).
      if (!wasColdPalaceEffectActiveForHistoricalEvent(linkedEffect, occurredAt.dayIndex)) {
        errors.push(incidentErr(
          `ColdPalaceIncident "${id}": effect "${effectId}" was not active at dayIndex ${occurredAt.dayIndex} (startTurn=${linkedEffect.startTurn}, liftedTurn=${linkedEffect.liftedTurn ?? "none"})`,
        ));
      }
    }

    // Kind-specific field rules — validate at runtime so the validator catches corrupt state
    // even when bypassing TypeScript (e.g. raw JSON from storage or test fixtures).
    const anyDelta = (incident as unknown as { healthDelta?: unknown }).healthDelta;
    if (kind === "petition") {
      // 7. petition must not carry healthDelta.
      if (anyDelta !== undefined) {
        errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=petition must not have healthDelta (got ${anyDelta})`));
      }
    } else if (kind === "health_deterioration") {
      // 8. health_deterioration: healthDelta required and must be negative.
      if (anyDelta === undefined || anyDelta === null) {
        errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=health_deterioration must have healthDelta`));
      } else if (typeof anyDelta === "number" && anyDelta >= 0) {
        errors.push(incidentErr(`ColdPalaceIncident "${id}": healthDelta must be negative (got ${anyDelta})`));
      }
    } else if (kind === "critical_illness") {
      const isPending = incident.status === "pending_response";
      const isResolved = incident.status === "resolved";
      const res = incident.resolution as string | undefined;

      // pending_response invariants:
      if (isPending) {
        // must not be acknowledged
        if (incident.acknowledged) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=pending_response must not be acknowledged`));
        }
        // must not have resolution
        if (res !== undefined) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=pending_response must not have resolution`));
        }
        // must not have resolvedAt
        if (incident.resolvedAt !== undefined) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=pending_response must not have resolvedAt`));
        }
        // must not have healthDelta
        if (incident.healthDelta !== undefined) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=pending_response must not have healthDelta`));
        }
      }

      // resolved invariants:
      if (isResolved) {
        // must be acknowledged
        if (!incident.acknowledged) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=resolved must be acknowledged`));
        }
        // must have resolution
        if (!res) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=resolved must have resolution`));
        }
        // must have resolvedAt
        if (incident.resolvedAt === undefined) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness status=resolved must have resolvedAt`));
        }
        // physician: healthDelta required and must be positive
        if (res === "physician") {
          if (incident.healthDelta === undefined) {
            errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness resolution=physician must have healthDelta`));
          } else if (incident.healthDelta <= 0) {
            errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness resolution=physician healthDelta must be positive (got ${incident.healthDelta})`));
          }
        }
        // ignore: healthDelta required and must be negative
        if (res === "ignore") {
          if (incident.healthDelta === undefined) {
            errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness resolution=ignore must have healthDelta`));
          } else if (incident.healthDelta >= 0) {
            errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness resolution=ignore healthDelta must be negative (got ${incident.healthDelta})`));
          }
        }
        // restored: must NOT have healthDelta
        if (res === "restored" && incident.healthDelta !== undefined) {
          errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness resolution=restored must not have healthDelta`));
        }
        // resolvedAt must not precede occurredAt — compare by dayIndex (absolute 旬 ordinal).
        if (incident.resolvedAt !== undefined) {
          if (incident.resolvedAt.dayIndex < incident.occurredAt.dayIndex) {
            errors.push(incidentErr(`ColdPalaceIncident "${id}": kind=critical_illness resolvedAt (dayIndex ${incident.resolvedAt.dayIndex}) must not precede occurredAt (dayIndex ${incident.occurredAt.dayIndex})`));
          }
        }
      }
    }
  }

  return errors;
}

/** Parse canonical intervention ID to { residentId, year, month } or null if malformed. */
function parseColdPalaceInterventionId(id: string): { residentId: string; year: number; month: number } | null {
  const match = id.match(/^cpa_(.+)_(\d+)_(\d{2})$/);
  if (!match) return null;
  const [, residentId, yearStr, monthStr] = match;
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
  return { residentId: residentId!, year, month };
}

export function validateColdPalaceInterventionLinks(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const { coldPalaceInterventions, statusEffects } = state;

  const seenIds = new Set<string>();
  const seenResidentMonth = new Map<string, string>(); // "charId:year:MM" → interventionId

  for (const intervention of coldPalaceInterventions) {
    const { id, residentId, effectId, kind, occurredAt } = intervention;

    // 1. Globally unique IDs.
    if (seenIds.has(id)) {
      errors.push(interventionErr(`ColdPalaceIntervention id "${id}" is not unique`));
    }
    seenIds.add(id);

    // 2. ID matches canonical format cpa_{residentId}_{year}_{MM}.
    const parsed = parseColdPalaceInterventionId(id);
    if (!parsed) {
      errors.push(interventionErr(`ColdPalaceIntervention id "${id}" does not match canonical format cpa_{residentId}_{year}_{MM}`));
    } else {
      const expectedId = coldPalaceInterventionId(parsed.residentId, parsed.year, parsed.month);
      if (id !== expectedId) {
        errors.push(interventionErr(`ColdPalaceIntervention id "${id}" does not match canonical id "${expectedId}"`));
      }
      if (parsed.residentId !== residentId) {
        errors.push(interventionErr(`ColdPalaceIntervention "${id}": id residentId "${parsed.residentId}" ≠ intervention.residentId "${residentId}"`));
      }
      // 2b. ID year/month must align with occurredAt.year/month.
      if (parsed.year !== occurredAt.year || parsed.month !== occurredAt.month) {
        errors.push(interventionErr(
          `ColdPalaceIntervention "${id}": canonical id slot ${parsed.year}-${padMonth(parsed.month)} ≠ occurredAt ${occurredAt.year}-${padMonth(occurredAt.month)}`,
        ));
      }
      // 3. At most one per resident per month.
      const slotKey = `${residentId}:${parsed.year}:${padMonth(parsed.month)}`;
      if (seenResidentMonth.has(slotKey)) {
        errors.push(interventionErr(`ColdPalaceIntervention duplicate resident/month: "${id}" and "${seenResidentMonth.get(slotKey)}"`));
      }
      seenResidentMonth.set(slotKey, id);
    }

    // 4. Linked effect exists and is kind=cold_palace.
    const linkedEffect = statusEffects.find((e): e is ColdPalaceEffect =>
      e.kind === "cold_palace" && e.id === effectId,
    );
    if (!linkedEffect) {
      errors.push(interventionErr(`ColdPalaceIntervention "${id}": effectId "${effectId}" not found in statusEffects`));
    } else {
      // 5. effect.characterId === intervention.residentId.
      if (linkedEffect.characterId !== residentId) {
        errors.push(interventionErr(
          `ColdPalaceIntervention "${id}": effectId "${effectId}" belongs to "${linkedEffect.characterId}", not "${residentId}"`,
        ));
      }
      // 6. Effect was active at occurredAt.dayIndex (uses historical helper for same-day death).
      if (!wasColdPalaceEffectActiveForHistoricalEvent(linkedEffect, occurredAt.dayIndex)) {
        errors.push(interventionErr(
          `ColdPalaceIntervention "${id}": effect "${effectId}" was not active at dayIndex ${occurredAt.dayIndex} (startTurn=${linkedEffect.startTurn}, liftedTurn=${linkedEffect.liftedTurn ?? "none"})`,
        ));
      }
    }

    // 7. occurredAt must not be in the future.
    if (occurredAt.dayIndex > state.calendar.dayIndex) {
      errors.push(interventionErr(
        `ColdPalaceIntervention "${id}": occurredAt.dayIndex ${occurredAt.dayIndex} is in the future (calendar.dayIndex=${state.calendar.dayIndex})`,
      ));
    }

    // 8. Kind-specific delta sign rules.
    if (kind === "personal_visit") {
      const delta = intervention.favorDelta;
      if (delta <= 0) {
        errors.push(interventionErr(`ColdPalaceIntervention "${id}": kind=personal_visit favorDelta must be positive (got ${delta})`));
      }
    } else if (kind === "physician") {
      const delta = intervention.healthDelta;
      if (delta <= 0) {
        errors.push(interventionErr(`ColdPalaceIntervention "${id}": kind=physician healthDelta must be positive (got ${delta})`));
      }
    }
  }

  return errors;
}

function madnessErr(msg: string): GameError {
  return gameError("state", "BAD_COLD_PALACE_MADNESS", msg);
}

export function validateColdPalaceMadnessLinks(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const { statusEffects, coldPalaceIncidents, standing } = state;

  const madnessEffects = statusEffects.filter(
    (e): e is ColdPalaceMadnessEffect => e.kind === "cold_palace_madness",
  );

  const seenMadnessIds = new Set<string>();
  const seenMadnessCharIds = new Set<string>();

  for (const effect of madnessEffects) {
    const { id, characterId, sourceColdPalaceEffectId, startedAt, startTurn } = effect;

    // 1. ID unique.
    if (seenMadnessIds.has(id)) {
      errors.push(madnessErr(`ColdPalaceMadnessEffect id "${id}" is not unique`));
    }
    seenMadnessIds.add(id);

    // 2. At most one per character.
    if (seenMadnessCharIds.has(characterId)) {
      errors.push(madnessErr(`Duplicate ColdPalaceMadnessEffect for character "${characterId}"`));
    }
    seenMadnessCharIds.add(characterId);

    // 3. Character standing exists.
    const st = standing[characterId];
    if (!st) {
      errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": characterId "${characterId}" has no standing`));
    }

    // 4. sourceColdPalaceEffectId links to a real cold_palace effect for the same character.
    const sourceEffect = statusEffects.find(
      (e): e is ColdPalaceEffect => e.kind === "cold_palace" && e.id === sourceColdPalaceEffectId,
    );
    if (!sourceEffect) {
      errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": sourceColdPalaceEffectId "${sourceColdPalaceEffectId}" not found`));
    } else {
      if (sourceEffect.characterId !== characterId) {
        errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": source effect belongs to "${sourceEffect.characterId}", not "${characterId}"`));
      }
      // 5. Source effect was active at startedAt.dayIndex (uses historical helper for same-day death).
      if (!wasColdPalaceEffectActiveForHistoricalEvent(sourceEffect, startedAt.dayIndex)) {
        errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": source effect was not active at startedAt.dayIndex ${startedAt.dayIndex}`));
      }
    }

    // 6. startTurn === startedAt.dayIndex.
    if (startTurn !== startedAt.dayIndex) {
      errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": startTurn ${startTurn} !== startedAt.dayIndex ${startedAt.dayIndex}`));
    }

    // 7. startedAt not in the future.
    if (startedAt.dayIndex > state.calendar.dayIndex) {
      errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": startedAt is in the future (dayIndex ${startedAt.dayIndex} > calendar.dayIndex ${state.calendar.dayIndex})`));
    }

    // 8. Living mad resident must still be under the active source cold-palace effect.
    if (st && st.lifecycle !== "deceased" && sourceEffect) {
      if (!isColdPalaceEffectActiveAt(sourceEffect, state.calendar.dayIndex)) {
        errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": living mad resident "${characterId}" must remain under the linked cold-palace effect (not lifted)`));
      }
    }

    // 9. Exactly one mental_breakdown incident must exist for this madness effect.
    const linkedIncidents = coldPalaceIncidents.filter(
      (i) => i.kind === "mental_breakdown" && (i as { madnessEffectId: string }).madnessEffectId === id,
    );
    if (linkedIncidents.length !== 1) {
      errors.push(madnessErr(`ColdPalaceMadnessEffect "${id}": expected exactly 1 mental_breakdown incident, found ${linkedIncidents.length}`));
    }
  }

  // Validate mental_breakdown incidents.
  const breakdownIncidents = coldPalaceIncidents.filter(
    (i): i is ColdPalaceMentalBreakdownIncident => i.kind === "mental_breakdown",
  );
  const seenBreakdownIds = new Set<string>();
  const seenBreakdownBySource = new Map<string, string>(); // sourceColdPalaceEffectId → incidentId

  for (const incident of breakdownIncidents) {
    const { id, residentId, effectId, madnessEffectId, occurredAt } = incident;

    // 1. ID unique.
    if (seenBreakdownIds.has(id)) {
      errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident id "${id}" is not unique`));
    }
    seenBreakdownIds.add(id);

    // 2. madnessEffectId links to a real ColdPalaceMadnessEffect.
    const linkedMadness = madnessEffects.find((e) => e.id === madnessEffectId);
    if (!linkedMadness) {
      errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": madnessEffectId "${madnessEffectId}" not found`));
    } else {
      // 3. madness.characterId === residentId.
      if (linkedMadness.characterId !== residentId) {
        errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": madness effect belongs to "${linkedMadness.characterId}", not "${residentId}"`));
      }
      // 4. effectId === madness.sourceColdPalaceEffectId.
      if (effectId !== linkedMadness.sourceColdPalaceEffectId) {
        errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": effectId "${effectId}" ≠ madness.sourceColdPalaceEffectId "${linkedMadness.sourceColdPalaceEffectId}"`));
      }
      // 5. occurredAt === madness.startedAt.dayIndex.
      if (occurredAt.dayIndex !== linkedMadness.startedAt.dayIndex) {
        errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": occurredAt.dayIndex ${occurredAt.dayIndex} ≠ madness.startedAt.dayIndex ${linkedMadness.startedAt.dayIndex}`));
      }
    }

    // 6. At most one mental_breakdown per cold-palace sentence.
    if (seenBreakdownBySource.has(effectId)) {
      errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident duplicate for sentence "${effectId}": "${id}" and "${seenBreakdownBySource.get(effectId)}"`));
    }
    seenBreakdownBySource.set(effectId, id);

    // 7. occurredAt not in the future.
    if (occurredAt.dayIndex > state.calendar.dayIndex) {
      errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": occurredAt is in the future`));
    }

    // 8. Source cold-palace effect active at occurredAt.
    const sourceColdPalaceEffect = statusEffects.find(
      (e): e is ColdPalaceEffect => e.kind === "cold_palace" && e.id === effectId,
    );
    if (!sourceColdPalaceEffect) {
      errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": effectId "${effectId}" not found`));
    } else if (!wasColdPalaceEffectActiveForHistoricalEvent(sourceColdPalaceEffect, occurredAt.dayIndex)) {
      errors.push(madnessErr(`ColdPalaceMentalBreakdownIncident "${id}": source cold-palace effect was not active at occurredAt.dayIndex ${occurredAt.dayIndex}`));
    }
  }

  return errors;
}
