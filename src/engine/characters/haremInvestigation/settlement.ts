/**
 * 调查任务结算（Phase 5B-2）。
 *
 * resolveInvestigationTask — 纯函数，根据案件真实 incident 信息（后台）
 *   生成脱敏后的 IntrigueInvestigationLead（玩家知识层）。
 *
 * settleDueInvestigationTasks — 在 settlePostAdvance 中每次时间推进后调用，
 *   处理所有 dueAt.dayIndex <= currentDayIndex 的 pending 任务。
 *
 * 知识边界：
 *   resolveInvestigationTask 可读取 haremIncidents 确定概率，
 *   但输出只包含脱敏后的 implicatedIds / clearedIds / revealedKinds。
 *   任何形如 "actorId / groundTruth / isTrueLead" 的字段一律不写入 Lead。
 */
import type { ContentDB } from "../../content/loader";
import type { GameState, HaremIntrigueReport } from "../../state/types";
import type { GameTime } from "../../calendar/time";
import { fromTurnIndex } from "../../calendar/time";
import { fnv1a64Hex } from "../../save/canonical";
import type { HaremIntrigueKind } from "../haremIntrigue/types";
import type { InvestigationTruth, HiddenEvidenceNode } from "./truth/types";
import type {
  IntrigueInvestigationTask,
  IntrigueInvestigationLead,
  InvestigationLeadStrength,
  InvestigationLeadClaim,
  InvestigationProgressPublicReport,
} from "./types";
import { isActiveCase } from "./types";
import { applyInvestigationLead } from "./leads";

// ── 确定性 RNG ────────────────────────────────────────────────────────

function makeInvestigationRng(
  rngSeed: string,
  caseId: string,
  taskId: string,
  method: string,
  subjectId: string | undefined,
): () => number {
  const seedStr = `investigation:${rngSeed}:${caseId}:${taskId}:${method}:${subjectId ?? "none"}`;
  let s = parseInt(fnv1a64Hex(seedStr).slice(0, 8), 16);
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ── 线索 ID 生成 ──────────────────────────────────────────────────────

export function nextLeadId(seq: number): string {
  return `ilead_${String(seq).padStart(6, "0")}`;
}

export function nextTaskId(seq: number): string {
  return `itask_${String(seq).padStart(6, "0")}`;
}

// ── 结果解析（可读后台真相，但只输出脱敏线索）────────────────────────

interface InvestigationResolution {
  lead: IntrigueInvestigationLead;
  nextSeq: number;
}

export function resolveInvestigationTask(
  state: GameState,
  task: IntrigueInvestigationTask,
  resolvedAt: GameTime,
): InvestigationResolution {
  const c = state.haremInvestigationCases.find((x) => x.id === task.caseId);
  if (!c) {
    const emptyLead: IntrigueInvestigationLead = {
      id: nextLeadId(state.haremInvestigationNextSeq),
      caseId: task.caseId,
      discoveredAt: resolvedAt,
      method: task.method,
      summaryCode: "orphan_task_skipped",
      strength: "tenuous",
      implicatedIds: [],
      clearedIds: [],
      revealedKinds: [],
    };
    return { lead: emptyLead, nextSeq: state.haremInvestigationNextSeq + 1 };
  }

  if (c.source.kind === "investigation_incident") {
    return resolveEvidenceDrivenTask(state, task, c.source.incidentId, resolvedAt);
  }
  return resolveLegacyIntrigueTask(state, task, c.source.incidentId, resolvedAt);
}

// ── 旧宫斗案件结算器 ──────────────────────────────────────────────────

function resolveLegacyIntrigueTask(
  state: GameState,
  task: IntrigueInvestigationTask,
  incidentId: string,
  resolvedAt: GameTime,
): InvestigationResolution {
  const rng = makeInvestigationRng(
    String(state.rngSeed),
    task.caseId,
    task.id,
    task.method,
    task.subjectId,
  );

  const incident = state.haremIncidents.find((i) => i.id === incidentId);
  const trueActorId = incident?.actorId;
  const trueKind: HaremIntrigueKind | undefined = incident?.kind;

  let strength: InvestigationLeadStrength = "tenuous";
  let implicatedIds: string[] = [];
  let clearedIds: string[] = [];
  let revealedKinds: HaremIntrigueKind[] = [];
  let summaryCode = "";

  const roll1 = rng();
  const roll2 = rng();
  const roll3 = rng();

  switch (task.method) {
    case "question_target": {
      summaryCode = roll1 < 0.6 ? "target_mentioned_unusual" : "target_noted_prior_activity";
      strength = roll2 < 0.5 ? "tenuous" : "plausible";
      if (trueKind && roll3 < 0.30) revealedKinds = [trueKind];
      break;
    }
    case "question_suspect": {
      const subject = task.subjectId;
      const isTrueActor = !!subject && subject === trueActorId;
      if (isTrueActor) {
        if (roll1 < 0.25) { strength = "confirmed"; implicatedIds = [subject]; summaryCode = "suspect_admitted_under_pressure"; }
        else if (roll1 < 0.60) { strength = "strong"; implicatedIds = [subject]; summaryCode = "suspect_contradicted_account"; }
        else if (roll1 < 0.85) { strength = "plausible"; implicatedIds = [subject]; summaryCode = "suspect_evasive_response"; }
        else { strength = "tenuous"; summaryCode = "suspect_denied_convincingly"; }
        if (trueKind && roll2 < 0.50) revealedKinds = [trueKind];
      } else {
        if (roll1 < 0.60) { strength = "tenuous"; clearedIds = subject ? [subject] : []; summaryCode = "suspect_cleared_alibi"; }
        else if (roll1 < 0.85) { strength = "tenuous"; summaryCode = "suspect_irrelevant_account"; }
        else { strength = "tenuous"; summaryCode = "suspect_inconclusive_account"; }
      }
      break;
    }
    case "quiet_inquiry": {
      summaryCode = "inquiry_gathered_servant_rumors";
      if (trueActorId && roll1 < 0.40) {
        implicatedIds = [trueActorId];
        strength = roll2 < 0.35 ? "strong" : "plausible";
        summaryCode = strength === "strong" ? "inquiry_tracked_actor_movement" : "inquiry_found_suspicious_pattern";
      } else if (roll1 < 0.70) {
        strength = "plausible";
        if (trueKind && roll2 < 0.60) revealedKinds = [trueKind];
        summaryCode = "inquiry_revealed_scheme_method";
      } else {
        strength = "tenuous";
        summaryCode = "inquiry_limited_findings";
      }
      break;
    }
  }

  const lead: IntrigueInvestigationLead = {
    id: nextLeadId(state.haremInvestigationNextSeq),
    caseId: task.caseId,
    discoveredAt: resolvedAt,
    method: task.method,
    summaryCode,
    strength,
    implicatedIds,
    clearedIds,
    revealedKinds,
  };
  return { lead, nextSeq: state.haremInvestigationNextSeq + 1 };
}

// ── 证据驱动案件结算器 ────────────────────────────────────────────────

/** 难度公式（确定性，不含随机；success = roll0to99 < effectiveDifficulty 为失败）。 */
function computeEffectiveDifficulty(
  node: HiddenEvidenceNode,
  truth: InvestigationTruth,
  elapsedPeriods: number,
): number {
  const raw = node.difficulty + elapsedPeriods * node.decayPerPeriod + Math.floor(truth.concealment / 5);
  return Math.max(5, Math.min(95, raw));
}

/** 将后台 EvidenceClaim 转成玩家知识层 InvestigationLeadClaim（脱敏）。 */
function sanitizeClaims(node: HiddenEvidenceNode): InvestigationLeadClaim[] {
  return node.claims.map((ec): InvestigationLeadClaim => {
    switch (ec.kind) {
      case "implicates_character":
        return { kind: "implicates_character", characterId: ec.characterRef, strength: ec.strength };
      case "exonerates_character":
        return { kind: "exonerates_character", characterId: ec.characterRef, strength: ec.strength };
      case "supports_cause":
        return { kind: "supports_cause", causeType: ec.causeType };
      case "reveals_method":
        return { kind: "reveals_mechanism", mechanism: ec.method };
      case "establishes_fact":
        return { kind: "establishes_fact", factCode: ec.factCode };
    }
  });
}

function resolveEvidenceDrivenTask(
  state: GameState,
  task: IntrigueInvestigationTask,
  incidentId: string,
  resolvedAt: GameTime,
): InvestigationResolution {
  const truth: InvestigationTruth | undefined = state.investigationTruths.find(
    (t) => t.incidentId === incidentId,
  );

  if (!truth) {
    // truth 缺失（应由 integrity 检查拦截）
    const lead: IntrigueInvestigationLead = {
      id: nextLeadId(state.haremInvestigationNextSeq),
      caseId: task.caseId,
      discoveredAt: resolvedAt,
      method: task.method,
      summaryCode: "evidence_truth_missing",
      strength: "tenuous",
      implicatedIds: [],
      clearedIds: [],
      revealedKinds: [],
    };
    return { lead, nextSeq: state.haremInvestigationNextSeq + 1 };
  }

  // 已发现节点 ID 集合（从已有 lead 推导，不需要新 GameState collection）
  const c = state.haremInvestigationCases.find((x) => x.id === task.caseId)!;
  const discoveredNodeIds = new Set(
    c.leadIds
      .map((lid) => state.haremInvestigationLeads[lid]?.sourceEvidenceNodeId)
      .filter(Boolean) as string[],
  );

  // 筛选候选节点：method 匹配 + 未发现 + prereq 满足
  const candidates = truth.evidenceNodes.filter(
    (n) =>
      n.discoverableBy.includes(task.method as import("./truth/types").EvidenceDiscoveryAction) &&
      !discoveredNodeIds.has(n.id) &&
      n.prerequisiteEvidenceIds.every((pid) => discoveredNodeIds.has(pid)),
  );

  // 确定性 RNG（同 state + task → 同结果）
  const rng = makeInvestigationRng(
    String(state.rngSeed),
    task.caseId,
    task.id,
    task.method,
    task.subjectId,
  );

  const incident = state.investigationIncidents.find((i) => i.id === incidentId);
  const elapsedPeriods = incident
    ? Math.max(0, resolvedAt.dayIndex - incident.occurredAt.dayIndex)
    : 0;

  // 尝试发现第一个通过难度检定的候选节点（至多一个）
  let discoveredNode: HiddenEvidenceNode | null = null;
  for (const node of candidates) {
    const effectiveDifficulty = computeEffectiveDifficulty(node, truth, elapsedPeriods);
    const roll = Math.floor(rng() * 100); // 0–99
    if (roll >= effectiveDifficulty) {
      discoveredNode = node;
      break;
    }
  }

  if (discoveredNode) {
    const claims = sanitizeClaims(discoveredNode);
    // implicatedIds: 来自 implicates_character strong/moderate claim（不暴露后台 culpritIds）
    const implicatedIds = claims
      .filter((cl): cl is Extract<InvestigationLeadClaim, { kind: "implicates_character" }> =>
        cl.kind === "implicates_character" && cl.strength !== "weak",
      )
      .map((cl) => cl.characterId);
    const clearedIds = claims
      .filter((cl): cl is Extract<InvestigationLeadClaim, { kind: "exonerates_character" }> =>
        cl.kind === "exonerates_character" && cl.strength === "strong",
      )
      .map((cl) => cl.characterId);

    const lead: IntrigueInvestigationLead = {
      id: nextLeadId(state.haremInvestigationNextSeq),
      caseId: task.caseId,
      discoveredAt: resolvedAt,
      method: task.method,
      summaryCode: `evidence_${discoveredNode.type}`,
      strength: claims.some((cl) => cl.kind === "implicates_character" && cl.strength === "strong") ? "strong"
        : claims.some((cl) => cl.kind === "implicates_character" && cl.strength === "moderate") ? "plausible"
        : "tenuous",
      implicatedIds,
      clearedIds,
      revealedKinds: [],
      sourceEvidenceNodeId: discoveredNode.id,
      claims,
    };
    return { lead, nextSeq: state.haremInvestigationNextSeq + 1 };
  }

  // 未发现任何节点
  const lead: IntrigueInvestigationLead = {
    id: nextLeadId(state.haremInvestigationNextSeq),
    caseId: task.caseId,
    discoveredAt: resolvedAt,
    method: task.method,
    summaryCode: "evidence_no_new_findings",
    strength: "tenuous",
    implicatedIds: [],
    clearedIds: [],
    revealedKinds: [],
  };
  return { lead, nextSeq: state.haremInvestigationNextSeq + 1 };
}

// ── settlement 主入口 ─────────────────────────────────────────────────

export interface InvestigationSettlementResult {
  state: GameState;
  settledTaskIds: string[];
  newLeads: IntrigueInvestigationLead[];
}

/**
 * 结算所有到期（dueAt.dayIndex <= currentDayIndex）的 pending 调查任务。
 * 不依赖 monthChanged；每次时间推进后均调用，支持 catch-up。
 * 结算顺序：dueAt.dayIndex ASC，然后 task.id ASC（稳定排序）。
 */
export function settleDueInvestigationTasks(
  _db: ContentDB,
  stateIn: GameState,
  currentTime: GameTime,
): InvestigationSettlementResult {
  const currentDayIndex = currentTime.dayIndex;

  const dueTasks = Object.values(stateIn.haremInvestigationTasks)
    .filter((t) => t.status === "pending" && t.dueAt.dayIndex <= currentDayIndex)
    .sort((a, b) => {
      const d = a.dueAt.dayIndex - b.dueAt.dayIndex;
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

  if (dueTasks.length === 0) {
    return { state: stateIn, settledTaskIds: [], newLeads: [] };
  }

  let state = stateIn;
  const settledTaskIds: string[] = [];
  const newLeads: IntrigueInvestigationLead[] = [];

  for (const task of dueTasks) {
    // 防御：案件已取消或关闭 → 同步取消孤儿 pending task，不生成线索（B2 修复）
    const taskCase = state.haremInvestigationCases.find((x) => x.id === task.caseId);
    if (!taskCase || !isActiveCase(taskCase.status)) {
      state = {
        ...state,
        haremInvestigationTasks: {
          ...state.haremInvestigationTasks,
          [task.id]: { ...task, status: "cancelled" as const },
        },
      };
      continue;
    }

    // 使用任务到期时刻作为结算时刻（pre-rollover semantics）
    const resolvedAt: GameTime = fromTurnIndex(task.dueAt.dayIndex);

    const { lead, nextSeq } = resolveInvestigationTask(state, task, resolvedAt);

    // 1) 写入线索
    const leads = { ...state.haremInvestigationLeads, [lead.id]: lead };

    // 2) 更新任务状态
    const tasks = {
      ...state.haremInvestigationTasks,
      [task.id]: {
        ...task,
        status: "resolved" as const,
        resolvedAt,
        leadId: lead.id,
      },
    };

    // 3) 合并线索知识进案件
    state = applyInvestigationLead(
      { ...state, haremInvestigationLeads: leads, haremInvestigationTasks: tasks, haremInvestigationNextSeq: nextSeq },
      lead,
    );

    // 4) 案件结算后若仍在 in_progress，且线索不足 → 回到 open 等待下一步指令
    const c = state.haremInvestigationCases.find((x) => x.id === task.caseId);
    if (c && c.status === "in_progress") {
      const cIdx = state.haremInvestigationCases.findIndex((x) => x.id === task.caseId);
      const cases = [...state.haremInvestigationCases];
      cases[cIdx] = { ...c, status: "open" };
      state = { ...state, haremInvestigationCases: cases };
    }

    // 5) 生成调查进展通报（幂等：按 task.id 去重）
    const reportId = `ireport_investigation_${task.id}`;
    const updatedCase = state.haremInvestigationCases.find((x) => x.id === task.caseId);
    if (updatedCase) {
      const reportKind = updatedCase.status === "ready_for_review" ? "investigation_final" as const : "investigation_update" as const;

      if (updatedCase.source.kind === "legacy_intrigue") {
        // 旧宫斗案件：进展通报写入 haremIntrigueReports
        const alreadyHasReport = state.haremIntrigueReports.some((r) => r.id === reportId);
        if (!alreadyHasReport) {
          const investigationReport: HaremIntrigueReport = {
            id: reportId,
            source: { incidentId: updatedCase.source.incidentId },
            reportKind,
            createdAt: resolvedAt,
            status: "unread",
            knownTargetIds: [...updatedCase.knownTargetIds],
            suspectedActorIds: [...updatedCase.suspectIds],
            suspectedKinds: [...updatedCase.suspectedKinds],
            knownOutcome: "unknown",
            confidence: updatedCase.confidence,
            summaryCode: lead.summaryCode,
            linkedInvestigationId: updatedCase.id,
          };
          state = { ...state, haremIntrigueReports: [...state.haremIntrigueReports, investigationReport] };
        }
      } else {
        // 证据驱动案件（investigation_incident）：进展通报写入 investigationPublicReports
        const alreadyHasReport = state.investigationPublicReports.some((r) => r.id === reportId);
        if (!alreadyHasReport) {
          const progressReport: InvestigationProgressPublicReport = {
            id: reportId,
            source: { kind: "investigation_incident", incidentId: updatedCase.source.incidentId },
            reportKind,
            createdAt: resolvedAt,
            status: "unread",
            linkedInvestigationId: updatedCase.id,
            knownTargetIds: [...updatedCase.knownTargetIds],
            suspectedActorIds: [...updatedCase.suspectIds],
            confidence: updatedCase.confidence,
            summaryCode: lead.summaryCode,
          };
          state = { ...state, investigationPublicReports: [...state.investigationPublicReports, progressReport] };
        }
      }
    }

    settledTaskIds.push(task.id);
    newLeads.push(lead);
  }

  return { state, settledTaskIds, newLeads };
}
