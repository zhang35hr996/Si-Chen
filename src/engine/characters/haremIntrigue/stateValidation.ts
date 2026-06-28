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

  const reportIds = new Set<string>();

  for (const report of data.haremIntrigueReports) {
    if (reportIds.has(report.id)) {
      errors.push(stateError("INTRIGUE_DUP_REPORT", `haremIntrigueReports: 重复 report id="${report.id}"`));
    }
    reportIds.add(report.id);

    if (!incidentIds.has(report.source.incidentId)) {
      errors.push(stateError("INTRIGUE_REPORT_ORPHAN", `haremIntrigueReports[id=${report.id}]: 引用不存在的 incidentId="${report.source.incidentId}"`));
    }

    if ((report.status === "actioned" || report.status === "archived") && !report.acknowledgedAt) {
      errors.push(stateError("INTRIGUE_REPORT_MISSING_ACK", `haremIntrigueReports[id=${report.id}]: status=${report.status} 但无 acknowledgedAt`));
    }
  }

  return errors;
}
