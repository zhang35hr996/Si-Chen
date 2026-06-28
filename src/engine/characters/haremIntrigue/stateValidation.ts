/**
 * 宫斗集合级链接完整性校验（Phase 5A-3a）。
 * 在 stateSchema superRefine 中调用；输入已通过基础 schema 验证。
 */
import type { GameError } from "../../infra/errors";
import { stateError } from "../../infra/errors";
import type {
  HaremScheme,
  HaremIncident,
  HaremIntrigueReport,
} from "../../state/types";
import { validateHaremIntriguePlan, validateHaremIntrigueOutcome } from "./validation";

export interface HaremIntrigueValidationInput {
  haremSchemes: HaremScheme[];
  haremIncidents: HaremIncident[];
  haremIntrigueReports: HaremIntrigueReport[];
  settledHaremIntriguePeriods: string[];
}

export function validateHaremIntrigueLinks(
  data: HaremIntrigueValidationInput,
): GameError[] {
  const errors: GameError[] = [];

  const schemeById = new Map<string, HaremScheme>();
  const sourceKeys = new Set<string>();

  for (const scheme of data.haremSchemes) {
    if (schemeById.has(scheme.id)) {
      errors.push(stateError("INTRIGUE_DUP_SCHEME", `haremSchemes: 重复 scheme id="${scheme.id}"`));
    }
    schemeById.set(scheme.id, scheme);

    if (sourceKeys.has(scheme.sourceKey)) {
      errors.push(stateError("INTRIGUE_DUP_SOURCE_KEY", `haremSchemes: 重复 sourceKey="${scheme.sourceKey}"`));
    }
    sourceKeys.add(scheme.sourceKey);

    const skMatch = /^harem_intrigue:(\d+):(\d{2})$/.exec(scheme.sourceKey);
    if (skMatch) {
      const skYear = parseInt(skMatch[1]!, 10);
      const skMonth = parseInt(skMatch[2]!, 10);
      if (skYear !== scheme.scheduledForYear || skMonth !== scheme.scheduledForMonth) {
        errors.push(stateError("INTRIGUE_SOURCE_KEY_MISMATCH", `haremSchemes[id=${scheme.id}]: sourceKey 与 scheduledFor 不一致`));
      }
    }

    if (scheme.plan.year !== scheme.scheduledForYear || scheme.plan.month !== scheme.scheduledForMonth) {
      errors.push(stateError("INTRIGUE_PLAN_TIME_MISMATCH", `haremSchemes[id=${scheme.id}]: plan.year/month 与 scheduledFor 不一致`));
    }

    if (scheme.status === "resolved" && !scheme.outcome) {
      errors.push(stateError("INTRIGUE_RESOLVED_NO_OUTCOME", `haremSchemes[id=${scheme.id}]: status=resolved 但无 outcome`));
    }

    // plan.sourceKey must match scheme.sourceKey
    if (scheme.plan.sourceKey !== scheme.sourceKey) {
      errors.push(stateError("INTRIGUE_SOURCE_KEY_MISMATCH", `haremSchemes[id=${scheme.id}]: plan.sourceKey="${scheme.plan.sourceKey}" !== scheme.sourceKey="${scheme.sourceKey}"`));
    }

    // Domain validators: plan invariants
    const planFindings = validateHaremIntriguePlan(scheme.plan);
    for (const f of planFindings) {
      errors.push(stateError(f.code, `haremSchemes[id=${scheme.id}].plan: ${f.message}`));
    }

    // Domain validators: outcome invariants (when present)
    if (scheme.outcome !== undefined) {
      const outcomeFindings = validateHaremIntrigueOutcome(scheme.plan, scheme.outcome);
      for (const f of outcomeFindings) {
        errors.push(stateError(f.code, `haremSchemes[id=${scheme.id}].outcome: ${f.message}`));
      }
    }
  }

  // settledHaremIntriguePeriods: valid format + no duplicates
  const PERIOD_RE = /^harem_intrigue_settlement:(\d+):(0[1-9]|1[0-2])$/;
  const seenPeriods = new Set<string>();
  for (const period of data.settledHaremIntriguePeriods) {
    if (!PERIOD_RE.test(period)) {
      errors.push(stateError("INTRIGUE_BAD_SOURCE_KEY", `settledHaremIntriguePeriods: 格式错误 "${period}"（期望 harem_intrigue_settlement:Y:MM，月份 01-12）`));
    }
    if (seenPeriods.has(period)) {
      errors.push(stateError("INTRIGUE_DUP_SOURCE_KEY", `settledHaremIntriguePeriods: 重复期号 "${period}"`));
    }
    seenPeriods.add(period);
  }

  const incidentBySchemeId = new Map<string, HaremIncident>();
  const incidentIds = new Set<string>();

  for (const incident of data.haremIncidents) {
    if (incidentIds.has(incident.id)) {
      errors.push(stateError("INTRIGUE_DUP_INCIDENT", `haremIncidents: 重复 incident id="${incident.id}"`));
    }
    incidentIds.add(incident.id);

    if (!schemeById.has(incident.schemeId)) {
      errors.push(stateError("INTRIGUE_INCIDENT_ORPHAN", `haremIncidents[id=${incident.id}]: 引用不存在的 schemeId="${incident.schemeId}"`));
      continue;
    }

    if (incidentBySchemeId.has(incident.schemeId)) {
      errors.push(stateError("INTRIGUE_DUP_INCIDENT_PER_SCHEME", `haremIncidents: scheme "${incident.schemeId}" 有多个 incident`));
    }
    incidentBySchemeId.set(incident.schemeId, incident);

    const scheme = schemeById.get(incident.schemeId)!;
    if (incident.consequencesApplied && scheme.status === "cancelled") {
      errors.push(stateError("INTRIGUE_CANCELLED_WITH_CONSEQUENCES", `haremIncidents[id=${incident.id}]: scheme 已 cancelled 但 consequencesApplied=true`));
    }

    if (incident.observationLevel === "exposed" && !incident.courtEventId) {
      errors.push(stateError("INTRIGUE_EXPOSED_NO_COURT_EVENT", `haremIncidents[id=${incident.id}]: observationLevel=exposed 但无 courtEventId`));
    }
  }

  // Lifecycle: status ↔ outcome ↔ incident count + cross-field consistency
  for (const scheme of data.haremSchemes) {
    const incident = incidentBySchemeId.get(scheme.id);
    const hasIncident = incident !== undefined;

    if (scheme.status === "pending") {
      if (scheme.outcome !== undefined) {
        errors.push(stateError("INTRIGUE_PENDING_HAS_OUTCOME", `haremSchemes[id=${scheme.id}]: status=pending 但有 outcome`));
      }
      if (hasIncident) {
        errors.push(stateError("INTRIGUE_PENDING_HAS_INCIDENT", `haremSchemes[id=${scheme.id}]: status=pending 但有 incident`));
      }
    } else if (scheme.status === "resolved") {
      // Outcome status consistency (INTRIGUE_RESOLVED_NO_OUTCOME already checked above)
      if (scheme.outcome && scheme.outcome.status !== "resolved") {
        errors.push(stateError("INTRIGUE_STATUS_MISMATCH", `haremSchemes[id=${scheme.id}]: status=resolved 但 outcome.status="${scheme.outcome.status}"`));
      }
      if (!hasIncident) {
        errors.push(stateError("INTRIGUE_RESOLVED_INCIDENT_COUNT", `haremSchemes[id=${scheme.id}]: status=resolved 需恰有 1 个 incident`));
      } else {
        // Cross-field: incident fields must match plan/outcome
        if (incident!.actorId !== scheme.plan.actorId) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: actorId 与 plan 不一致`));
        }
        if (incident!.targetId !== scheme.plan.targetId) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: targetId 与 plan 不一致`));
        }
        if (incident!.kind !== scheme.plan.kind) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: kind="${incident!.kind}" 与 plan.kind="${scheme.plan.kind}" 不一致`));
        }
        if (scheme.outcome?.status === "resolved" && incident!.success !== scheme.outcome.success) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: success=${incident!.success} 与 outcome.success=${scheme.outcome.success} 不一致`));
        }
        if (!incident!.consequencesApplied) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: status=resolved 但 consequencesApplied=false`));
        }
      }
    } else if (scheme.status === "cancelled") {
      if (!scheme.outcome) {
        errors.push(stateError("INTRIGUE_CANCELLED_NO_OUTCOME", `haremSchemes[id=${scheme.id}]: status=cancelled 但无 outcome`));
      } else if (scheme.outcome.status !== "cancelled") {
        errors.push(stateError("INTRIGUE_STATUS_MISMATCH", `haremSchemes[id=${scheme.id}]: status=cancelled 但 outcome.status="${scheme.outcome.status}"`));
      }
      if (!hasIncident) {
        errors.push(stateError("INTRIGUE_CANCELLED_INCIDENT_COUNT", `haremSchemes[id=${scheme.id}]: status=cancelled 需恰有 1 个 incident`));
      } else {
        if (incident!.actorId !== scheme.plan.actorId) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: actorId 与 plan 不一致`));
        }
        if (incident!.targetId !== scheme.plan.targetId) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: targetId 与 plan 不一致`));
        }
        if (incident!.kind !== scheme.plan.kind) {
          errors.push(stateError("INTRIGUE_INCIDENT_FIELD_MISMATCH", `haremIncidents[id=${incident!.id}]: kind="${incident!.kind}" 与 plan.kind="${scheme.plan.kind}" 不一致`));
        }
      }
    }
  }

  const reportIds = new Set<string>();

  for (const report of data.haremIntrigueReports) {
    if (reportIds.has(report.id)) {
      errors.push(stateError("INTRIGUE_DUP_REPORT", `haremIntrigueReports: 重复 report id="${report.id}"`));
    }
    reportIds.add(report.id);

    if (!incidentIds.has(report.source.incidentId)) {
      errors.push(stateError("INTRIGUE_REPORT_ORPHAN", `haremIntrigueReports[id=${report.id}]: 引用不存在的 incidentId="${report.source.incidentId}"`));
    }

    if (report.status !== "unread" && !report.acknowledgedAt) {
      errors.push(stateError("INTRIGUE_REPORT_MISSING_ACK", `haremIntrigueReports[id=${report.id}]: status=${report.status} 但无 acknowledgedAt`));
    }
    if (report.status === "unread" && report.acknowledgedAt) {
      errors.push(stateError("INTRIGUE_REPORT_SPURIOUS_ACK", `haremIntrigueReports[id=${report.id}]: status=unread 但有 acknowledgedAt`));
    }
  }

  return errors;
}
