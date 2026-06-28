/**
 * 皇嗣异常事件原子生成（Phase 5B-2B1）。
 *
 * 纯函数：从 GameState 生成 incident + truth + 玩家可见公开报告，三者原子写入，
 * 不出现「incident 成功、truth 成功、report 失败」的半完成状态。
 *
 * 知识边界：
 *   - InvestigationTruth 写入 state.investigationTruths（后台），绝不进入报告；
 *   - InvestigationPublicReport 只携带 incident 的公开字段（受害皇嗣、症状、
 *     公开指控人/被指控者、现场公开事实），不读取 truth 的 causeType /
 *     culpritIds / method / motive / evidenceNodes。
 */
import { ok, err, type Result } from "../../infra/result";
import { stateError, type GameError } from "../../infra/errors";
import type { GameState } from "../../state/types";
import { toGameTime } from "../../calendar/time";
import {
  buildHeirHealthTruthContext,
  resolveInvestigationTruth,
  hashStr,
} from "./truth/truthResolver";
import type { HeirHealthAnomalyIncident, HeirHealthSymptom } from "./truth/types";
import type { HeirHealthAnomalyPublicReport } from "./types";

export interface HeirHealthAnomalyBundleParams {
  victimHeirId: string;
  custodianId?: string;
  accuserIds: string[];
  initiallyAccusedIds: string[];
  symptom: HeirHealthSymptom;
  publicFactCodes: string[];
  /** 0–100：仅用于后台真相权重，不进入公开报告。 */
  victimHealth: number;
}

export interface HeirHealthAnomalyBundle {
  state: GameState;
  incidentId: string;
  truthId: string;
  reportId: string;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 原子创建皇嗣异常 incident + 后台真相 + 公开报告。
 *
 * 幂等：三者按确定性 ID 派生，若三者已同时存在则原样返回；若仅部分存在，
 * 视为存档损坏，返回 INCONSISTENT_INVESTIGATION_STATE。
 */
export function createHeirHealthAnomalyBundle(
  state: GameState,
  params: HeirHealthAnomalyBundleParams,
): Result<HeirHealthAnomalyBundle, GameError[]> {
  const at = toGameTime(state.calendar);

  // sourceKey 内部派生，调用方无法影响
  const month = String(state.calendar.month).padStart(2, "0");
  const sourceKey = `heir_health_anomaly:${state.calendar.year}:${month}:${params.victimHeirId}`;
  const incidentId = `heir_health_${params.victimHeirId}_${hashStr(sourceKey)}`;
  const truthId = `itruth_${incidentId}`;
  const reportId = `iarep_${incidentId}`;

  const existingIncident = state.investigationIncidents.find((i) => i.id === incidentId);
  const existingTruth = state.investigationTruths.find((t) => t.id === truthId);
  const existingReport = state.investigationPublicReports.find((r) => r.id === reportId);

  const presentCount =
    (existingIncident !== undefined ? 1 : 0) +
    (existingTruth !== undefined ? 1 : 0) +
    (existingReport !== undefined ? 1 : 0);

  if (presentCount === 3) {
    // 幂等仅当新参数与既有事件完全一致。ID 仅由 {year, month, victimHeirId}
    // 派生，粒度为「每名皇嗣每月至多一个健康异常」；若同键但参数不同，说明是
    // 另一桩不同事件，绝不能当作重复调用静默吞掉 —— 报冲突。
    const inc = existingIncident!;
    const sameOccurrence =
      inc.symptom === params.symptom &&
      inc.custodianId === params.custodianId &&
      arraysEqual(inc.accuserIds, params.accuserIds) &&
      arraysEqual(inc.initiallyAccusedIds, params.initiallyAccusedIds) &&
      arraysEqual(inc.publicFactCodes, params.publicFactCodes);
    if (!sameOccurrence) {
      return err([
        stateError(
          "INVESTIGATION_OCCURRENCE_CONFLICT",
          `A different heir-health anomaly already exists for occurrence key "${sourceKey}" (victim=${params.victimHeirId}, month=${state.calendar.year}-${month}). 每名皇嗣每月至多一个健康异常。`,
          { context: { incidentId, sourceKey } },
        ),
      ]);
    }
    return ok({ state, incidentId, truthId, reportId });
  }
  if (presentCount !== 0) {
    return err([
      stateError(
        "INCONSISTENT_INVESTIGATION_STATE",
        `Investigation bundle is partially present: incidentId="${incidentId}" (incident=${existingIncident !== undefined}, truth=${existingTruth !== undefined}, report=${existingReport !== undefined})`,
        { context: { incidentId, truthId, reportId } },
      ),
    ]);
  }

  const incident: HeirHealthAnomalyIncident = {
    id: incidentId,
    eventFamily: "heir_health_anomaly",
    occurredAt: at,
    sourceKey,
    victimHeirId: params.victimHeirId,
    custodianId: params.custodianId,
    accuserIds: params.accuserIds,
    initiallyAccusedIds: params.initiallyAccusedIds,
    symptom: params.symptom,
    publicFactCodes: params.publicFactCodes,
  };

  const context = buildHeirHealthTruthContext(incident, state, params.victimHealth);
  const truth = resolveInvestigationTruth(context, state.rngSeed);

  // 脱敏公开报告：只取 incident 公开字段，绝不读取 truth
  const report: HeirHealthAnomalyPublicReport = {
    id: reportId,
    source: { kind: "investigation_incident", incidentId },
    reportKind: "anomaly",
    eventFamily: "heir_health_anomaly",
    createdAt: at,
    status: "unread",
    knownTargetIds: [params.victimHeirId],
    suspectedActorIds: [...params.initiallyAccusedIds],
    confidence: params.initiallyAccusedIds.length > 0 ? "plausible" : "tenuous",
    symptomCode: params.symptom,
    publicFactCodes: [...params.publicFactCodes],
    accuserIds: [...params.accuserIds],
  };

  return ok({
    state: {
      ...state,
      investigationIncidents: [...state.investigationIncidents, incident],
      investigationTruths: [...state.investigationTruths, truth],
      investigationPublicReports: [...state.investigationPublicReports, report],
    },
    incidentId,
    truthId,
    reportId,
  });
}
