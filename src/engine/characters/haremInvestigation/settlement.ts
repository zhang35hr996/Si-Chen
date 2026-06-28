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
import type { GameState } from "../../state/types";
import type { GameTime } from "../../calendar/time";
import { fromTurnIndex } from "../../calendar/time";
import { fnv1a64Hex } from "../../save/canonical";
import type { HaremIntrigueKind } from "../haremIntrigue/types";
import type {
  IntrigueInvestigationTask,
  IntrigueInvestigationLead,
  InvestigationLeadStrength,
} from "./types";
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
  const rng = makeInvestigationRng(
    String(state.rngSeed),
    task.caseId,
    task.id,
    task.method,
    task.subjectId,
  );

  const c = state.haremInvestigationCases.find((x) => x.id === task.caseId)!;
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
          // 罕见：此人虽非主谋，但供出了另一个嫌疑人
          const possibleSuspects = c.knownTargetIds.filter(
            (id) => !c.suspectIds.includes(id) && id !== subject,
          );
          if (possibleSuspects.length > 0 && roll2 < 0.30) {
            const newSuspect = possibleSuspects[Math.floor(roll2 * possibleSuspects.length)];
            implicatedIds = newSuspect ? [newSuspect] : [];
            strength = "tenuous";
          }
          summaryCode = "suspect_implicated_other";
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

    settledTaskIds.push(task.id);
    newLeads.push(lead);
  }

  return { state, settledTaskIds, newLeads };
}
