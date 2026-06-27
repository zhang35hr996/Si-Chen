/**
 * haremDisciplineIncidents 跨字段一致性验证（PUNISH-4G-B）。
 * 在 stateSchema.ts 的 superRefine 中调用。
 */
import type { GameError } from "../infra/errors";
import { stateError } from "../infra/errors";

interface GameTimeSlice {
  year: number;
  month: number;
  dayIndex: number;
}

interface IncidentSlice {
  id: string;
  actorId: string;
  targetId: string;
  status: "pending_response" | "resolved";
  resolution?: string;
  resolvedAt?: unknown;
  occurredAt?: unknown;
  courtEventId: string;
  resolutionEventId?: string;
  actorSnapshot?: { peakFavor?: number; favor?: number };
  targetSnapshot?: { peakFavor?: number; favor?: number };
}

interface ChronicleSlice {
  id: string;
  type?: string;
  payload?: { subtype?: string; incidentId?: string; resolution?: string };
  participants?: Array<{ charId: string; role?: string }>;
}

interface StateSlice {
  haremDisciplineIncidents: IncidentSlice[];
  chronicle: ChronicleSlice[];
  standing: Record<string, unknown>;
}

function toGameTimeSlice(t: unknown): GameTimeSlice | null {
  if (typeof t !== "object" || t === null) return null;
  const { year, month, dayIndex } = t as Record<string, unknown>;
  if (typeof year !== "number" || typeof month !== "number" || typeof dayIndex !== "number") return null;
  return { year, month, dayIndex };
}

function expectedId(occurredAt: unknown): string | null {
  const gt = toGameTimeSlice(occurredAt);
  if (!gt) return null;
  return `hdi_${gt.year}_${String(gt.month).padStart(2, "0")}`;
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
  const usedResolutionEventIds = new Set<string>();

  for (const inc of data.haremDisciplineIncidents) {
    // 1. Unique ID.
    if (seenIds.has(inc.id)) {
      errors.push(stateError("HDI_DUPLICATE_ID", `haremDisciplineIncidents: duplicate id ${inc.id}`));
    }
    seenIds.add(inc.id);

    // 2. Self-target.
    if (inc.actorId === inc.targetId) {
      errors.push(
        stateError("HDI_SELF_TARGET", `haremDisciplineIncidents[id=${inc.id}]: actorId === targetId "${inc.actorId}"`),
      );
    }

    // 3. Canonical ID must match occurredAt.year/month.
    const exp = expectedId(inc.occurredAt);
    if (exp === null || inc.id !== exp) {
      errors.push(
        stateError(
          "HDI_BAD_CANONICAL_ID",
          `haremDisciplineIncidents[id=${inc.id}]: id does not match occurredAt (expected "${exp ?? "??"}")`,
        ),
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

    // 6. resolved must have resolvedAt with dayIndex >= occurredAt.dayIndex.
    if (inc.status === "resolved") {
      const occGt = toGameTimeSlice(inc.occurredAt);
      const resGt = toGameTimeSlice(inc.resolvedAt);
      if (occGt !== null && resGt !== null && resGt.dayIndex < occGt.dayIndex) {
        errors.push(
          stateError(
            "HDI_RESOLVED_BEFORE_OCCURRENCE",
            `haremDisciplineIncidents[id=${inc.id}]: resolvedAt (dayIndex ${resGt.dayIndex}) is before occurredAt (dayIndex ${occGt.dayIndex})`,
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
      // 8. Event must be type "conflict".
      if (evt.type !== "conflict") {
        errors.push(
          stateError(
            "HDI_BAD_EVENT_TYPE",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} type is "${evt.type}", expected "conflict"`,
          ),
        );
      }

      // 9. payload.subtype must be "harem_discipline".
      if (evt.payload?.subtype !== "harem_discipline") {
        errors.push(
          stateError(
            "HDI_BAD_EVENT_TYPE",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} payload.subtype is "${evt.payload?.subtype}", expected "harem_discipline"`,
          ),
        );
      }

      // 10. payload.incidentId must equal incident.id (missing counts as mismatch).
      if (evt.payload?.incidentId !== inc.id) {
        errors.push(
          stateError(
            "HDI_EVENT_INCIDENT_MISMATCH",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} payload.incidentId "${evt.payload?.incidentId}" !== "${inc.id}"`,
          ),
        );
      }

      // 11. participants must include actor as discipliner and target as disciplined.
      const parts = evt.participants ?? [];
      const hasActor = parts.some((p) => p.charId === inc.actorId && p.role === "discipliner");
      if (!hasActor) {
        errors.push(
          stateError(
            "HDI_EVENT_PARTICIPANT_MISMATCH",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} missing discipliner participant ${inc.actorId}`,
          ),
        );
      }
      const hasTarget = parts.some((p) => p.charId === inc.targetId && p.role === "disciplined");
      if (!hasTarget) {
        errors.push(
          stateError(
            "HDI_EVENT_PARTICIPANT_MISMATCH",
            `haremDisciplineIncidents[id=${inc.id}]: courtEvent ${inc.courtEventId} missing disciplined participant ${inc.targetId}`,
          ),
        );
      }
    }

    // 12. actorId must be in standing.
    if (!(inc.actorId in data.standing)) {
      errors.push(
        stateError(
          "HDI_MISSING_ACTOR",
          `haremDisciplineIncidents[id=${inc.id}]: actorId ${inc.actorId} not found in standing`,
        ),
      );
    }

    // 13. targetId must be in standing.
    if (!(inc.targetId in data.standing)) {
      errors.push(
        stateError(
          "HDI_MISSING_TARGET",
          `haremDisciplineIncidents[id=${inc.id}]: targetId ${inc.targetId} not found in standing`,
        ),
      );
    }

    // 14. Snapshot invariant: peakFavor >= favor.
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

    // 15. resolved 必须有 resolutionEventId；已有则交叉校验裁断事件。
    if (inc.status === "resolved") {
      if (!inc.resolutionEventId) {
        errors.push(
          stateError(
            "HDI_MISSING_RESOLUTION_EVENT",
            `haremDisciplineIncidents[id=${inc.id}]: resolved incident missing resolutionEventId`,
          ),
        );
      } else {
        if (usedResolutionEventIds.has(inc.resolutionEventId)) {
          errors.push(
            stateError(
              "HDI_RESOLUTION_EVENT_REUSED",
              `haremDisciplineIncidents[id=${inc.id}]: resolutionEventId ${inc.resolutionEventId} is shared by another incident`,
            ),
          );
        }
        usedResolutionEventIds.add(inc.resolutionEventId);

        const resEvt = eventMap.get(inc.resolutionEventId);
        if (!resEvt) {
          errors.push(
            stateError(
              "HDI_MISSING_RESOLUTION_EVENT",
              `haremDisciplineIncidents[id=${inc.id}]: resolutionEventId ${inc.resolutionEventId} not found in chronicle`,
            ),
          );
        } else {
          if (resEvt.payload?.subtype !== "harem_discipline_resolution") {
            errors.push(
              stateError(
                "HDI_BAD_RESOLUTION_EVENT",
                `haremDisciplineIncidents[id=${inc.id}]: resolution event subtype "${resEvt.payload?.subtype}" expected "harem_discipline_resolution"`,
              ),
            );
          }
          if (resEvt.payload?.incidentId !== inc.id) {
            errors.push(
              stateError(
                "HDI_RESOLUTION_INCIDENT_MISMATCH",
                `haremDisciplineIncidents[id=${inc.id}]: resolution event payload.incidentId "${resEvt.payload?.incidentId}" !== "${inc.id}"`,
              ),
            );
          }
        }
      }
    }
  }

  return errors;
}
