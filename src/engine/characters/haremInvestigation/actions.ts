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

  // 已关闭/取消/待裁定（裁定后才关闭）→ 不允许新任务
  if (!isActiveCase(c.status) || c.status === "ready_for_review") return [];

  // 已有 pending 任务 → 等待结算
  if (hasPendingTask(state, caseId)) return [];

  if (c.source.kind === "investigation_incident") {
    return availableEvidenceActions(state, c);
  }
  return availableLegacyActions(state, c);
}

function availableLegacyActions(
  state: GameState,
  c: IntrigueInvestigationCase,
): AvailableInvestigationAction[] {
  const actions: AvailableInvestigationAction[] = [];

  // 询问受害者：须有已知目标且目标仍存活
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

function availableEvidenceActions(
  state: GameState,
  c: IntrigueInvestigationCase,
): AvailableInvestigationAction[] {
  const actions: AvailableInvestigationAction[] = [];

  // 查验脉案与药物：受害皇嗣仍存活时可用
  const aliveTargets = c.knownTargetIds.filter((id) => isAlive(state, id));
  if (aliveTargets.length > 0) {
    actions.push({
      method: "medical_examination",
      apCost: INVESTIGATION_METHOD_AP.medical_examination,
      durationDays: INVESTIGATION_METHOD_DAYS.medical_examination,
    });
  }

  // 询问宫人：始终可用
  actions.push({
    method: "question_servants",
    apCost: INVESTIGATION_METHOD_AP.question_servants,
    durationDays: INVESTIGATION_METHOD_DAYS.question_servants,
  });

  // 重建事发时序：始终可用
  actions.push({
    method: "reconstruct_timeline",
    apCost: INVESTIGATION_METHOD_AP.reconstruct_timeline,
    durationDays: INVESTIGATION_METHOD_DAYS.reconstruct_timeline,
  });

  // 追查钱物流向：始终可用
  actions.push({
    method: "trace_money",
    apCost: INVESTIGATION_METHOD_AP.trace_money,
    durationDays: INVESTIGATION_METHOD_DAYS.trace_money,
  });

  // 搜查住处：需选存活嫌疑人
  const aliveSuspects = c.suspectIds.filter((id) => isAlive(state, id));
  if (aliveSuspects.length > 0) {
    actions.push({
      method: "search_quarters",
      subjectCandidateIds: aliveSuspects,
      apCost: INVESTIGATION_METHOD_AP.search_quarters,
      durationDays: INVESTIGATION_METHOD_DAYS.search_quarters,
    });
  }

  // 获取关键证词：候选来自公开报告中已知人物（指控者 + 被指控者）
  const publicReport = state.investigationPublicReports.find(
    (r) => r.source.incidentId === c.source.incidentId && r.reportKind === "anomaly",
  );
  const testimonyCandidates: string[] = [];
  if (publicReport && publicReport.reportKind === "anomaly") {
    for (const id of [...publicReport.accuserIds, ...publicReport.suspectedActorIds]) {
      if (!testimonyCandidates.includes(id) && isAlive(state, id)) {
        testimonyCandidates.push(id);
      }
    }
  }
  if (testimonyCandidates.length > 0) {
    actions.push({
      method: "obtain_testimony",
      subjectCandidateIds: testimonyCandidates,
      apCost: INVESTIGATION_METHOD_AP.obtain_testimony,
      durationDays: INVESTIGATION_METHOD_DAYS.obtain_testimony,
    });
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

  const isLegacy = c.source.kind === "legacy_intrigue";
  const legacyMethods = new Set(["question_target", "question_suspect", "quiet_inquiry"]);
  const evidenceMethods = new Set(["medical_examination", "question_servants", "reconstruct_timeline", "trace_money", "search_quarters", "obtain_testimony"]);

  if (isLegacy && !legacyMethods.has(method)) {
    return `案件 "${c.id}" 为宫斗案件，不支持证据调查方法 "${method}"`;
  }
  if (!isLegacy && !evidenceMethods.has(method)) {
    return `案件 "${c.id}" 为证据驱动案件，不支持旧调查方法 "${method}"`;
  }

  // legacy 方法校验
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

  // evidence 方法校验
  if (method === "search_quarters") {
    if (!subjectId) return "搜查住处须指定搜查对象";
    if (!c.suspectIds.includes(subjectId)) return `"${subjectId}" 不在当前嫌疑人名单中`;
    const alive = state.standing[subjectId];
    if (!alive || alive.lifecycle === "deceased") return `"${subjectId}" 已不在人世，无法搜查`;
  }
  if (method === "obtain_testimony") {
    if (!subjectId) return "获取证词须指定证人";
    const st = state.standing[subjectId];
    if (!st || st.lifecycle === "deceased") return `"${subjectId}" 已不在人世，无法获取证词`;
  }
  return null; // OK
}
