/**
 * 调查行动可用性计算（Phase 5B-2）。
 * 纯函数：只读取玩家知识层，不读取 haremIncidents/haremSchemes 真相。
 */
import type { GameState } from "../../state/types";
import type { IntrigueInvestigationCase } from "./types";
import { INVESTIGATION_METHOD_AP, INVESTIGATION_METHOD_DAYS, isActiveCase } from "./types";
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

export function availableInvestigationActions(
  state: GameState,
  caseId: string,
): AvailableInvestigationAction[] {
  const c = state.haremInvestigationCases.find((x) => x.id === caseId);
  if (!c) return [];

  // 5B-2B1 临时封锁：证据驱动事件族（investigation_incident）的调查行动尚未接入
  // （留待 5B-2B2）。在此之前，禁止此类案件启动旧结算器任务，避免读取不到旧
  // haremIncidents 真相而生成错误线索（误排除嫌疑人 / 凭空抬高置信度）。
  if (c.source.kind === "investigation_incident") return [];

  // 已关闭/取消/待裁定（裁定后才关闭）→ 不允许新任务
  if (!isActiveCase(c.status) || c.status === "ready_for_review") return [];

  // 已有 pending 任务 → 等待结算
  if (hasPendingTask(state, caseId)) return [];

  const actions: AvailableInvestigationAction[] = [];

  // 询问受害者：须有已知目标且目标仍存活（H3：返回候选列表）
  const aliveTargets = c.knownTargetIds.filter((id) => isAlive(state, id));
  if (aliveTargets.length > 0) {
    actions.push({
      method: "question_target",
      subjectCandidateIds: aliveTargets,
      apCost: INVESTIGATION_METHOD_AP.question_target,
      durationDays: INVESTIGATION_METHOD_DAYS.question_target,
    });
  }

  // 传问嫌疑人：须有嫌疑人且至少一人仍存活
  const aliveSuspects = c.suspectIds.filter((id) => isAlive(state, id));
  if (aliveSuspects.length > 0) {
    actions.push({
      method: "question_suspect",
      subjectCandidateIds: aliveSuspects,
      apCost: INVESTIGATION_METHOD_AP.question_suspect,
      durationDays: INVESTIGATION_METHOD_DAYS.question_suspect,
    });
  }

  // 暗中查访：案件活跃即可
  actions.push({
    method: "quiet_inquiry",
    apCost: INVESTIGATION_METHOD_AP.quiet_inquiry,
    durationDays: INVESTIGATION_METHOD_DAYS.quiet_inquiry,
  });

  return actions;
}

/** 验证指定案件是否可以接受新调查任务（单独暴露给 store 使用）。 */
export function validateCanStartTask(
  state: GameState,
  c: IntrigueInvestigationCase,
  method: InvestigationMethod,
  subjectId?: string,
): string | null {
  // 5B-2B1 临时封锁：证据驱动事件族的证据调查尚未接入（留待 5B-2B2）
  if (c.source.kind === "investigation_incident") {
    return `案件 "${c.id}" 的证据调查尚未接入，暂不能下令`;
  }
  if (!isActiveCase(c.status)) {
    return `案件 "${c.id}" 状态 "${c.status}" 不允许新增调查任务`;
  }
  if (c.status === "ready_for_review") {
    return `案件 "${c.id}" 已达待裁定状态，不能继续调查`;
  }
  if (hasPendingTask(state, c.id)) {
    return `案件 "${c.id}" 已有待结算调查任务，请等待结算后再下令`;
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
