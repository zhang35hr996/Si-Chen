/**
 * 调查行动可用性计算（Phase 5B-2）。
 * 纯函数：只读取玩家知识层，不读取 haremIncidents/haremSchemes 真相。
 */
import type { GameState } from "../../state/types";
import type { IntrigueInvestigationCase } from "./types";
import {
  INVESTIGATION_METHOD_AP,
  INVESTIGATION_METHOD_DAYS,
  EVIDENCE_INVESTIGATION_METHODS,
  LEGACY_INVESTIGATION_METHODS,
  isActiveCase,
} from "./types";
import type { InvestigationMethod } from "./types";

export interface AvailableInvestigationAction {
  method: InvestigationMethod;
  /** question_target / question_suspect 时的候选对象列表；quiet_inquiry 为 undefined。 */
  subjectCandidateIds?: string[];
  apCost: number;
  durationDays: number;
  reason?: string;
}

/** 是否可以再开始新任务（只允许同一案件同时 1 个 pending 任务）。 */
function hasPendingTask(state: GameState, caseId: string): boolean {
  return Object.values(state.haremInvestigationTasks).some(
    (t) => t.caseId === caseId && t.status === "pending",
  );
}

/** 给定角色 ID 是否仍存活（不是 deceased）。 */
function isAlive(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  return !!st && st.lifecycle !== "deceased";
}

function actionOf(method: InvestigationMethod, subjectCandidateIds?: string[]): AvailableInvestigationAction {
  return {
    method,
    ...(subjectCandidateIds ? { subjectCandidateIds } : {}),
    apCost: INVESTIGATION_METHOD_AP[method],
    durationDays: INVESTIGATION_METHOD_DAYS[method],
  };
}

export function availableInvestigationActions(
  state: GameState,
  caseId: string,
): AvailableInvestigationAction[] {
  const c = state.haremInvestigationCases.find((x) => x.id === caseId);
  if (!c) return [];

  // 已关闭/取消/待裁定（裁定后才关闭）→ 不允许新任务
  if (!isActiveCase(c.status) || c.status === "ready_for_review") return [];

  // 已有 pending 任务 → 等待结算
  if (hasPendingTask(state, caseId)) return [];

  // 5B-2B2a：按案件来源分流可用行动
  return c.source.kind === "investigation_incident"
    ? availableEvidenceActions(state, c)
    : availableLegacyActions(state, c);
}

/** 旧宫斗案件（legacy_intrigue）的三种调查行动（行为不变）。 */
function availableLegacyActions(
  state: GameState,
  c: IntrigueInvestigationCase,
): AvailableInvestigationAction[] {
  const actions: AvailableInvestigationAction[] = [];

  const aliveTargets = c.knownTargetIds.filter((id) => isAlive(state, id));
  if (aliveTargets.length > 0) {
    actions.push(actionOf("question_target", aliveTargets));
  }

  const aliveSuspects = c.suspectIds.filter((id) => isAlive(state, id));
  if (aliveSuspects.length > 0) {
    actions.push(actionOf("question_suspect", aliveSuspects));
  }

  actions.push(actionOf("quiet_inquiry"));
  return actions;
}

/**
 * 证据驱动案件（investigation_incident）的调查行动（5B-2B2a）。
 * 只读玩家已知字段决定可用性，绝不读取 InvestigationTruth（否则泄露后台事实）。
 */
function availableEvidenceActions(
  state: GameState,
  c: IntrigueInvestigationCase,
): AvailableInvestigationAction[] {
  const actions: AvailableInvestigationAction[] = [
    actionOf("medical_examination"),
    actionOf("question_servants"),
    actionOf("reconstruct_timeline"),
    actionOf("trace_money"),
    actionOf("obtain_testimony"),
  ];

  // 搜查住处：须有仍存活的嫌疑人作为对象
  const aliveSuspects = c.suspectIds.filter((id) => isAlive(state, id));
  if (aliveSuspects.length > 0) {
    actions.push(actionOf("search_quarters", aliveSuspects));
  }

  return actions;
}

/** 验证指定案件是否可以接受新调查任务（单独暴露给 store 使用）。 */
export function validateCanStartTask(
  state: GameState,
  c: IntrigueInvestigationCase,
  method: InvestigationMethod,
  subjectId?: string,
): string | null {
  if (!isActiveCase(c.status)) {
    return `案件 "${c.id}" 状态 "${c.status}" 不允许新增调查任务`;
  }
  if (c.status === "ready_for_review") {
    return `案件 "${c.id}" 已达待裁定状态，不能继续调查`;
  }
  if (hasPendingTask(state, c.id)) {
    return `案件 "${c.id}" 已有待结算调查任务，请等待结算后再下令`;
  }

  // 方法必须与案件来源匹配（两套调查模型不得混用）
  if (c.source.kind === "investigation_incident") {
    if (!EVIDENCE_INVESTIGATION_METHODS.has(method)) {
      return `证据驱动案件 "${c.id}" 不接受调查方法 "${method}"`;
    }
    // 搜查住处须指定仍存活的嫌疑人
    if (method === "search_quarters") {
      if (!subjectId) return "搜查住处须指定调查对象";
      if (!c.suspectIds.includes(subjectId)) return `"${subjectId}" 不在当前嫌疑人名单中`;
      const st = state.standing[subjectId];
      if (!st || st.lifecycle === "deceased") return `"${subjectId}" 已不在人世，无法搜查`;
    }
    return null;
  }

  // legacy_intrigue
  if (!LEGACY_INVESTIGATION_METHODS.has(method)) {
    return `旧宫斗案件 "${c.id}" 不接受调查方法 "${method}"`;
  }
  if (method === "question_suspect") {
    if (!subjectId) return "传问嫌疑人须指定调查对象";
    if (!c.suspectIds.includes(subjectId)) return `"${subjectId}" 不在当前嫌疑人名单中`;
    const alive = state.standing[subjectId];
    if (!alive || alive.lifecycle === "deceased") return `"${subjectId}" 已不在人世，无法传问`;
  }
  if (method === "question_target") {
    if (!subjectId) return "询问受害者须指定具体询问对象";
    if (!c.knownTargetIds.includes(subjectId)) return `"${subjectId}" 不在受害者名单 knownTargetIds 中`;
    const st = state.standing[subjectId];
    if (!st || st.lifecycle === "deceased") return `"${subjectId}" 已不在人世，无法询问`;
  }
  return null; // OK
}
