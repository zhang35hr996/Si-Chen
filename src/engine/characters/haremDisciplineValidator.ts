/**
 * haremDisciplineIncidents 跨字段一致性验证（PUNISH-4G-B）。
 * 在 stateSchema.ts 的 superRefine 中调用。
 */
import type { GameError } from "../infra/errors";
import { stateError } from "../infra/errors";

interface IncidentSlice {
  id: string;
  actorId: string;
  targetId: string;
  status: "pending_response" | "resolved";
  resolution?: string;
  resolvedAt?: unknown;
  occurredAt?: unknown;
  courtEventId: string;
  actorSnapshot?: { peakFavor?: number; favor?: number };
  targetSnapshot?: { peakFavor?: number; favor?: number };
}

interface ChronicleSlice {
  id: string;
  type?: string;
  payload?: { subtype?: string; incidentId?: string };
  participants?: Array<{ charId: string; role?: string }>;
}

interface StateSlice {
  haremDisciplineIncidents: IncidentSlice[];
  chronicle: ChronicleSlice[];
  standing: Record<string, unknown>;
}

/** Canonical id format: hdi_{year}_{month2digits} */
const HDI_ID_RE = /^hdi_\d+_\d{2}$/;

function gameTimeToOrd(t: unknown): number | null {
  if (typeof t !== "object" || t === null) return null;
  const { year, month } = t as Record<string, unknown>;
  if (typeof year !== "number" || typeof month !== "number") return null;
  return year * 12 + (month - 1);
}

/**
 * 验证 haremDisciplineIncidents 跨字段约束。
 */
export function validateHaremDisciplineLinks(data: StateSlice): GameError[] {
  const errors: GameError[] = [];
  const eventMap = new Map<string, ChronicleSlice>();
  for (const e of data.chronicle) {
    eventMap.set(e.id, e);
  }

  const seenIds = new Set<string>();
  const pendingTargets = new Set<string>();

  for (const inc of data.haremDisciplineIncidents) {
    // 1. Unique ID.
    if (seenIds.has(inc.id)) {
      errors.push(stateError("HDI_DUPLICATE_ID", `haremDisciplineIncidents: duplicate id ${inc.id}`));
    }
    seenIds.add(inc.id);

    // 2. Canonical ID format.
    if (!HDI_ID_RE.test(inc.id)) {
      errors.push(
        stateError("HDI_BAD_CANONICAL_ID", `haremDisciplineIncidents: id "${inc.id}" does not match hdi_{year}_{mm}`),
      );
    }

    // 3. Self-target.
    if (inc.actorId === inc.targetId) {
      errors.push(
        stateError("HDI_SELF_TARGET", `haremDisciplineIncidents[id=${inc.id}]: actorId === targetId "${inc.actorId}"`),
      );
    }

    // 4. At most one pending per target.
    if (inc.status === "pending_response") {
      if (pendingTargets.has(inc.targetId)) {
        errors.push(
          stateError(
            "HDI_MULTI_PENDING",
            `haremDisciplineIncidents: targetId ${inc.targetId} has multiple pending_response incidents`,
          ),
        );
      }
      pendingTargets.add(inc.targetId);

      // 5. pending must NOT have resolvedAt.
      if (inc.resolvedAt !== undefined) {
        errors.push(
          stateError(
            "HDI_PENDING_HAS_RESOLVED_AT",
            `haremDisciplineIncidents[id=${inc.id}]: pending_response incident has resolvedAt`,
          ),
        );
      }
    }

    // 6. resolved must have resolvedAt after occurredAt.
    if (inc.status === "resolved") {
      const occOrd = gameTimeToOrd(inc.occurredAt);
      const resOrd = gameTimeToOrd(inc.resolvedAt);
      if (occOrd !== null && resOrd !== null && resOrd < occOrd) {
        errors.push(
          stateError(
            "HDI_RESOLVED_BEFORE_OCCURRENCE",
            `haremDisciplineIncidents[id=${inc.id}]: resolvedAt is before occurredAt`,
          ),
        );
      }
    }

    // 7. courtEventId exists in chronicle.
    const evt = eventMap.get(inc.courtEventId);
    if (!evt) {
      errors.push(
        stateError(
          "HDI_MISSING_EVENT",
          `haremDisciplineIncidents[id=${inc.id}]: courtEventId ${inc.courtEventId} not found in chronicle`,
        ),
      );
    } else {
      // 8. Event must be type "conflict" with subtype "harem_discipline".
      if (evt.type !== "conflict") {
        errors.push(
          stateError(
            "HDI_BAD_EVENT_TYPE",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} type is "${evt.type}", expected "conflict"`,
          ),
        );
      }
      if (evt.payload?.subtype !== "harem_discipline") {
        errors.push(
          stateError(
            "HDI_BAD_EVENT_TYPE",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} payload.subtype is "${evt.payload?.subtype}", expected "harem_discipline"`,
          ),
        );
      }

      // 9. payload.incidentId must match incident.id.
      if (evt.payload?.incidentId !== undefined && evt.payload.incidentId !== inc.id) {
        errors.push(
          stateError(
            "HDI_EVENT_INCIDENT_MISMATCH",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} payload.incidentId "${evt.payload.incidentId}" !== incident id`,
          ),
        );
      }

      // 10. Event participants must include actor as discipliner and target as disciplined.
      if (evt.participants) {
        const actorPart = evt.participants.find((p) => p.charId === inc.actorId && p.role === "discipliner");
        if (!actorPart) {
          errors.push(
            stateError(
              "HDI_EVENT_PARTICIPANT_MISMATCH",
              `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} missing discipliner participant ${inc.actorId}`,
            ),
          );
        }
        const targetPart = evt.participants.find((p) => p.charId === inc.targetId && p.role === "disciplined");
        if (!targetPart) {
          errors.push(
            stateError(
              "HDI_EVENT_PARTICIPANT_MISMATCH",
              `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} missing disciplined participant ${inc.targetId}`,
            ),
          );
        }
      }
    }

    // 11. actorId must be in standing.
    if (!(inc.actorId in data.standing)) {
      errors.push(
        stateError(
          "HDI_MISSING_ACTOR",
          `haremDisciplineIncidents[id=${inc.id}]: actorId ${inc.actorId} not found in standing`,
        ),
      );
    }

    // 12. targetId must be in standing.
    if (!(inc.targetId in data.standing)) {
      errors.push(
        stateError(
          "HDI_MISSING_TARGET",
          `haremDisciplineIncidents[id=${inc.id}]: targetId ${inc.targetId} not found in standing`,
        ),
      );
    }

    // 13. Snapshot invariant: peakFavor >= favor.
    if (inc.actorSnapshot) {
      const { peakFavor, favor } = inc.actorSnapshot;
      if (typeof peakFavor === "number" && typeof favor === "number" && peakFavor < favor) {
        errors.push(
          stateError(
            "HDI_BAD_SNAPSHOT",
            `haremDisciplineIncidents[id=${inc.id}]: actor peakFavor ${peakFavor} < favor ${favor}`,
          ),
        );
      }
    }
    if (inc.targetSnapshot) {
      const { peakFavor, favor } = inc.targetSnapshot;
      if (typeof peakFavor === "number" && typeof favor === "number" && peakFavor < favor) {
        errors.push(
          stateError(
            "HDI_BAD_SNAPSHOT",
            `haremDisciplineIncidents[id=${inc.id}]: target peakFavor ${peakFavor} < favor ${favor}`,
          ),
        );
      }
    }
  }

  return errors;
}
