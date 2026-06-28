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
import type {
  IntrigueInvestigationCase,
  IntrigueInvestigationTask,
  IntrigueInvestigationLead,
  InvestigationLeadStrength,
  InvestigationLeadClaim,
  InvestigationProgressPublicReport,
} from "./types";
import { isActiveCase } from "./types";
import { applyInvestigationLead } from "./leads";
import { hashStr } from "./truth/truthResolver";
import type { HiddenEvidenceNode, EvidenceClaim, InvestigationTruth } from "./truth/types";

// ── mulberry32（证据发现确定性 RNG，5B-2B2a）─────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

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

/**
 * 调查任务结算入口：按案件来源分轨。
 *   legacy_intrigue       → resolveLegacyIntrigueTask（读 haremIncidents，行为不变）
 *   investigation_incident → resolveEvidenceDrivenTask（读 InvestigationTruth.evidenceNodes）
 */
export function resolveInvestigationTask(
  state: GameState,
  task: IntrigueInvestigationTask,
  resolvedAt: GameTime,
): InvestigationResolution {
  const c = state.haremInvestigationCases.find((x) => x.id === task.caseId);
  if (!c) {
    // 孤儿任务（integrity 检查应已拦截），跳过而非崩溃
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
    return resolveEvidenceDrivenTask(state, c, task, resolvedAt);
  }
  return resolveLegacyIntrigueTask(state, c, task, resolvedAt);
}

function resolveLegacyIntrigueTask(
  state: GameState,
  c: IntrigueInvestigationCase,
  task: IntrigueInvestigationTask,
  resolvedAt: GameTime,
): InvestigationResolution {
  const rng = makeInvestigationRng(
    String(state.rngSeed),
    task.caseId,
    task.id,
    task.method,
    task.subjectId,
  );

  const incident = state.haremIncidents.find((i) => i.id === c.source.incidentId);
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
      // 询问受害者：容易查明手段，不轻易确认主谋
      summaryCode = roll1 < 0.6 ? "target_mentioned_unusual" : "target_noted_prior_activity";
      strength = roll2 < 0.5 ? "tenuous" : "plausible";

      // 30% 概率揭示真实手段
      if (trueKind && roll3 < 0.30) {
        revealedKinds = [trueKind];
      }
      break;
    }

    case "question_suspect": {
      const subject = task.subjectId;
      const isTrueActor = !!subject && subject === trueActorId;

      if (isTrueActor) {
        // 询问真实主谋：有较大概率获得强力线索
        if (roll1 < 0.25) {
          strength = "confirmed";
          implicatedIds = [subject];
          summaryCode = "suspect_admitted_under_pressure";
        } else if (roll1 < 0.60) {
          strength = "strong";
          implicatedIds = [subject];
          summaryCode = "suspect_contradicted_account";
        } else if (roll1 < 0.85) {
          strength = "plausible";
          implicatedIds = [subject];
          summaryCode = "suspect_evasive_response";
        } else {
          // 狡猾的主谋伪装成功
          strength = "tenuous";
          summaryCode = "suspect_denied_convincingly";
        }
        // 顺带揭示手段
        if (trueKind && roll2 < 0.50) {
          revealedKinds = [trueKind];
        }
      } else {
        // 询问非主谋：大概率得到排除，小概率误导性线索
        if (roll1 < 0.60) {
          strength = "tenuous";
          clearedIds = subject ? [subject] : [];
          summaryCode = "suspect_cleared_alibi";
        } else if (roll1 < 0.85) {
          strength = "tenuous";
          summaryCode = "suspect_irrelevant_account";
        } else {
          // 非主谋无不在场证明 → 供述无用，案件无变化
          strength = "tenuous";
          summaryCode = "suspect_inconclusive_account";
        }
      }
      break;
    }

    case "quiet_inquiry": {
      // 暗中查访：耗时较长，有机会找到真实嫌疑人
      summaryCode = "inquiry_gathered_servant_rumors";

      if (trueActorId && roll1 < 0.40) {
        // 40% 概率查到真实主谋的蛛丝马迹
        implicatedIds = [trueActorId];
        strength = roll2 < 0.35 ? "strong" : "plausible";
        if (strength === "strong") {
          summaryCode = "inquiry_tracked_actor_movement";
        } else {
          summaryCode = "inquiry_found_suspicious_pattern";
        }
      } else if (roll1 < 0.70) {
        // 仅揭示手段
        strength = "plausible";
        if (trueKind && roll2 < 0.60) {
          revealedKinds = [trueKind];
        }
        summaryCode = "inquiry_revealed_scheme_method";
      } else {
        // 线索较少
        strength = "tenuous";
        summaryCode = "inquiry_limited_findings";
      }
      break;
    }
  }

  const leadId = nextLeadId(state.haremInvestigationNextSeq);
  const lead: IntrigueInvestigationLead = {
    id: leadId,
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

// ── 证据驱动结算（investigation_incident，5B-2B2a）────────────────────

/** claim 强度 → 线索强度（证据案件单条线索最高 strong；confirmed 由 5B-2B2b 评估决定）。 */
function claimStrengthToLead(s: "weak" | "moderate" | "strong"): InvestigationLeadStrength {
  return s === "strong" ? "strong" : s === "moderate" ? "strong" : "plausible";
}

/** 把隐藏证据节点的 claim 脱敏为玩家可见线索。绝不写入 truthId / node 内部引用之外的后台信息。 */
function materializeLeadFromEvidence(
  task: IntrigueInvestigationTask,
  node: HiddenEvidenceNode,
  leadId: string,
  resolvedAt: GameTime,
): IntrigueInvestigationLead {
  const claims: InvestigationLeadClaim[] = [];
  const implicatedIds: string[] = [];
  const clearedIds: string[] = [];
  let strength: InvestigationLeadStrength = "tenuous";

  for (const ec of node.claims as EvidenceClaim[]) {
    switch (ec.kind) {
      case "implicates_character":
        claims.push({ kind: "implicates_character", characterId: ec.characterRef, strength: ec.strength });
        if (!implicatedIds.includes(ec.characterRef)) implicatedIds.push(ec.characterRef);
        strength = strongerLead(strength, claimStrengthToLead(ec.strength));
        break;
      case "exonerates_character":
        claims.push({ kind: "exonerates_character", characterId: ec.characterRef, strength: ec.strength });
        if (!clearedIds.includes(ec.characterRef)) clearedIds.push(ec.characterRef);
        strength = strongerLead(strength, claimStrengthToLead(ec.strength));
        break;
      case "supports_cause":
        claims.push({ kind: "supports_cause", causeType: ec.causeType });
        strength = strongerLead(strength, "plausible");
        break;
      case "reveals_method":
        claims.push({ kind: "reveals_mechanism", mechanism: ec.method });
        strength = strongerLead(strength, "plausible");
        break;
      case "establishes_fact":
        claims.push({ kind: "establishes_fact", factCode: ec.factCode });
        break;
    }
  }

  return {
    id: leadId,
    caseId: task.caseId,
    discoveredAt: resolvedAt,
    method: task.method,
    summaryCode: `evidence_${node.factCode}`,
    strength,
    implicatedIds,
    clearedIds,
    revealedKinds: [],
    sourceEvidenceNodeId: node.id,
    claims,
  };
}

const LEAD_ORDER: InvestigationLeadStrength[] = ["tenuous", "plausible", "strong", "confirmed"];
function strongerLead(a: InvestigationLeadStrength, b: InvestigationLeadStrength): InvestigationLeadStrength {
  return LEAD_ORDER.indexOf(a) >= LEAD_ORDER.indexOf(b) ? a : b;
}

/** 「未发现新证据」线索：不指认/不排除任何人，不携带证据节点。 */
function noEvidenceLead(
  task: IntrigueInvestigationTask,
  leadId: string,
  resolvedAt: GameTime,
): IntrigueInvestigationLead {
  return {
    id: leadId,
    caseId: task.caseId,
    discoveredAt: resolvedAt,
    method: task.method,
    summaryCode: "investigation_no_new_evidence",
    strength: "tenuous",
    implicatedIds: [],
    clearedIds: [],
    revealedKinds: [],
  };
}

function resolveEvidenceDrivenTask(
  state: GameState,
  c: IntrigueInvestigationCase,
  task: IntrigueInvestigationTask,
  resolvedAt: GameTime,
): InvestigationResolution {
  const seq = state.haremInvestigationNextSeq;
  const leadId = nextLeadId(seq);
  const done = (lead: IntrigueInvestigationLead): InvestigationResolution => ({ lead, nextSeq: seq + 1 });

  const truth: InvestigationTruth | undefined = state.investigationTruths.find(
    (t) => t.incidentId === c.source.incidentId,
  );
  if (!truth) return done(noEvidenceLead(task, leadId, resolvedAt));

  // 已发现节点集合：从案件既有线索的 sourceEvidenceNodeId 推导（不另设顶层集合）
  const discovered = new Set<string>();
  for (const lid of c.leadIds) {
    const prev = state.haremInvestigationLeads[lid];
    if (prev?.sourceEvidenceNodeId) discovered.add(prev.sourceEvidenceNodeId);
  }

  // 候选：方法匹配 + 未发现 + 前置证据均已发现
  const eligible = truth.evidenceNodes.filter(
    (n) =>
      !discovered.has(n.id) &&
      (n.discoverableBy as string[]).includes(task.method) &&
      n.prerequisiteEvidenceIds.every((pid) => discovered.has(pid)),
  );
  if (eligible.length === 0) return done(noEvidenceLead(task, leadId, resolvedAt));

  const rng = mulberry32(
    hashStr(
      `investigation_evidence:${state.rngSeed}:${c.id}:${task.id}:${task.method}:${task.subjectId ?? "none"}:${truth.id}`,
    ),
  );

  // 确定性加权选择：难度越低权重越高
  const weights = eligible.map((n) => Math.max(1, 101 - n.difficulty));
  const total = weights.reduce((a, b) => a + b, 0);
  let pickRand = rng() * total;
  let node = eligible[eligible.length - 1]!;
  for (let i = 0; i < eligible.length; i++) {
    pickRand -= weights[i]!;
    if (pickRand <= 0) { node = eligible[i]!; break; }
  }

  // 二元发现判定：roll0-99 >= 有效难度 → 发现
  const elapsedPeriods = Math.max(0, resolvedAt.dayIndex - truth.generatedAt.dayIndex);
  const effectiveDifficulty = clamp(
    node.difficulty + elapsedPeriods * node.decayPerPeriod + Math.floor(truth.concealment / 5),
    5,
    95,
  );
  const roll = Math.floor(rng() * 100);
  if (roll < effectiveDifficulty) {
    // 失败：节点仍未发现（无 sourceEvidenceNodeId），可在后续任务重试（无累积加成）
    return done(noEvidenceLead(task, leadId, resolvedAt));
  }

  return done(materializeLeadFromEvidence(task, node, leadId, resolvedAt));
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

    // 5) 生成调查进展通报（幂等：按 task.id 去重）。
    //    按案件来源分流：旧宫斗 → haremIntrigueReports；证据案件 → investigationPublicReports。
    const updatedCase = state.haremInvestigationCases.find((x) => x.id === task.caseId);
    if (updatedCase && updatedCase.source.kind === "investigation_incident") {
      const progressId = `iprog_${task.id}`;
      if (!state.investigationPublicReports.some((r) => r.id === progressId)) {
        const reportKind: InvestigationProgressPublicReport["reportKind"] =
          updatedCase.status === "ready_for_review" ? "investigation_final" : "investigation_update";
        const progressReport: InvestigationProgressPublicReport = {
          id: progressId,
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
    } else if (updatedCase) {
      const reportId = `ireport_investigation_${task.id}`;
      if (!state.haremIntrigueReports.some((r) => r.id === reportId)) {
        const reportKind: HaremIntrigueReport["reportKind"] =
          updatedCase.status === "ready_for_review" ? "investigation_final" : "investigation_update";
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
    }

    settledTaskIds.push(task.id);
    newLeads.push(lead);
  }

  return { state, settledTaskIds, newLeads };
}
