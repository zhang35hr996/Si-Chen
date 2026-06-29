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
  /** question_target / question_suspect 时的候选对象列表。 */
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

/** 角色是否仍存活（在 standing 中且非 deceased）。不适用于皇嗣。 */
function isAliveChar(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  return !!st && st.lifecycle !== "deceased";
}

/** 皇嗣是否仍存活（在 bloodline.heirs 中且 lifecycle=alive）。 */
function isLivingHeir(state: GameState, heirId: string): boolean {
  return state.resources.bloodline.heirs.some(
    (heir) => heir.id === heirId && heir.lifecycle === "alive",
  );
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

  const aliveTargets = c.knownTargetIds.filter((id) => isAliveChar(state, id));
  if (aliveTargets.length > 0) {
    actions.push({
      method: "question_target",
      subjectCandidateIds: aliveTargets,
      apCost: INVESTIGATION_METHOD_AP.question_target,
      durationDays: INVESTIGATION_METHOD_DAYS.question_target,
    });
  }

  const aliveSuspects = c.suspectIds.filter((id) => isAliveChar(state, id));
  if (aliveSuspects.length > 0) {
    actions.push({
      method: "question_suspect",
      subjectCandidateIds: aliveSuspects,
      apCost: INVESTIGATION_METHOD_AP.question_suspect,
      durationDays: INVESTIGATION_METHOD_DAYS.question_suspect,
    });
  }

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

  // 查验脉案与药物：受害皇嗣仍存活时可用（皇嗣在 bloodline.heirs，不在 standing）
  const aliveHeirTargets = c.knownTargetIds.filter((id) => isLivingHeir(state, id));
  if (aliveHeirTargets.length > 0) {
    actions.push({
      method: "medical_examination",
      apCost: INVESTIGATION_METHOD_AP.medical_examination,
      durationDays: INVESTIGATION_METHOD_DAYS.medical_examination,
    });
  }

  // 询问宫人 / 重建事发时序 / 追查钱物流向：始终可用
  for (const method of ["question_servants", "reconstruct_timeline", "trace_money"] as const) {
    actions.push({
      method,
      apCost: INVESTIGATION_METHOD_AP[method],
      durationDays: INVESTIGATION_METHOD_DAYS[method],
    });
  }

  // 搜查相关住处 / 获取关键证词：始终可用（不绑定具体对象，后续加 discoverySubjectIds 后再恢复）
  for (const method of ["search_quarters", "obtain_testimony"] as const) {
    actions.push({
      method,
      apCost: INVESTIGATION_METHOD_AP[method],
      durationDays: INVESTIGATION_METHOD_DAYS[method],
    });
  }

  return actions;
}

const LEGACY_METHODS = new Set<InvestigationMethod>(["question_target", "question_suspect", "quiet_inquiry"]);
const EVIDENCE_METHODS = new Set<InvestigationMethod>([
  "medical_examination", "question_servants", "reconstruct_timeline",
  "trace_money", "search_quarters", "obtain_testimony",
]);

/** 验证指定案件是否可以接受新调查任务（供 Store 使用，与 availableInvestigationActions 共享校验逻辑）。 */
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
  if (isLegacy && !LEGACY_METHODS.has(method)) {
    return `案件 "${c.id}" 为宫斗案件，不支持证据调查方法 "${method}"`;
  }
  if (!isLegacy && !EVIDENCE_METHODS.has(method)) {
    return `案件 "${c.id}" 为证据驱动案件，不支持旧调查方法 "${method}"`;
  }

  // legacy 方法校验
  if (method === "question_suspect") {
    if (!subjectId) return "传问嫌疑人须指定调查对象";
    if (!c.suspectIds.includes(subjectId)) return `"${subjectId}" 不在当前嫌疑人名单中`;
    if (!isAliveChar(state, subjectId)) return `"${subjectId}" 已不在人世，无法传问`;
  }
  if (method === "question_target") {
    if (!subjectId) return "询问受害者须指定具体询问对象";
    if (!c.knownTargetIds.includes(subjectId)) return `"${subjectId}" 不在受害者名单 knownTargetIds 中`;
    if (!isAliveChar(state, subjectId)) return `"${subjectId}" 已不在人世，无法询问`;
  }

  // evidence 方法校验
  if (method === "medical_examination") {
    // 须有存活皇嗣目标（皇嗣在 bloodline.heirs，不在 standing）
    const aliveHeirs = c.knownTargetIds.filter((id) => isLivingHeir(state, id));
    if (aliveHeirs.length === 0) return "受害皇嗣已不在人世，无法查验脉案";
  }
  // search_quarters / obtain_testimony 为非对象型行动，不验证 subjectId。
  // 待 HiddenEvidenceNode.discoverySubjectIds 模型建立后再恢复对象筛选。

  return null; // OK
}
