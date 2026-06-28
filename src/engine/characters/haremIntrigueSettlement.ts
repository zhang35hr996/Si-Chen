/**
 * 月度宫斗 settlement（Phase 5A-3a）。
 *
 * 执行所有逾期 due 的 pending schemes（catch-up）：
 *   1. 检查幂等期号键
 *   2. 解析结果（resolveIntrigueOutcome）
 *   3. 应用 standing / household / nation 后果
 *   4. 写入 actor 秘密记忆 + target 后果记忆
 *   5. 根据 observationLevel 决定是否追加 CourtEvent
 *   6. 生成脱敏的 HaremIntrigueReport（玩家知识层）
 *   7. 规划下月阴谋
 *   8. 写入幂等期号键
 *
 * 纯函数——入参 state 不被修改。
 * 返回 Result；CourtEvent 追加失败会令整个 settlement 失败。
 */
import type { ContentDB } from "../content/loader";
import type {
  GameState,
  HaremScheme,
  HaremIncident,
  HaremIntrigueReport,
  HaremIntrigueObservationLevel,
} from "../state/types";
import type { GameTime } from "../calendar/time";
import { makeGameTime } from "../calendar/time";
import { appendCourtEvent } from "../chronicle/append";
import { applyFavorDelta } from "./favor";
import { memoryEntryId } from "../state/newGame";
import type { Result } from "../infra/result";
import { ok, err } from "../infra/result";
import { stateError } from "../infra/errors";
import type { GameError } from "../infra/errors";
import {
  resolveIntrigueOutcome,
  planMonthlyHaremIntrigue,
  buildIntrigueSourceKey,
} from "./haremIntrigue/index";
import type {
  HaremIntriguePlan,
  HaremIntrigueResolvedOutcome,
  HaremIntrigueKind,
} from "./haremIntrigue/types";

// ── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 计算下一个月的 GameTime（period=early）。 */
function nextMonthAt(at: GameTime): GameTime {
  const nextMonth = at.month === 12 ? 1 : at.month + 1;
  const nextYear = at.month === 12 ? at.year + 1 : at.year;
  return makeGameTime(nextYear, nextMonth, "early");
}

/** 月度幂等期号键：格式 "harem_intrigue_settlement:{year}:{MM}"。 */
function settlementPeriodKey(year: number, month: number): string {
  return `harem_intrigue_settlement:${year}:${String(month).padStart(2, "0")}`;
}

/** 月度序数（用于排序逾期 scheme）。 */
function monthOrdinal(year: number, month: number): number {
  return year * 12 + month;
}

// ── Label maps ───────────────────────────────────────────────────────────────

const INTRIGUE_KIND_LABELS: Record<HaremIntrigueKind, string> = {
  slander: "谗言中伤",
  false_accusation: "诬陷构罪",
  steal_credit: "窃占功劳",
  faction_pressure: "派系施压",
  servant_subversion: "收买宫人",
};

// ── observationLevel derivation ──────────────────────────────────────────────

/**
 * 事件当时产生了何种可见迹象（在 settlement 时冻结）。
 * - exposed: 败露（discovered=true）
 * - anomaly: 未败露但成功且影响明显（potency >= 60）
 * - none: 其余
 */
function deriveObservationLevel(
  resolved: HaremIntrigueResolvedOutcome,
  plan: HaremIntriguePlan,
): HaremIntrigueObservationLevel {
  if (resolved.discovered) return "exposed";
  if (resolved.success && plan.potency >= 60) return "anomaly";
  return "none";
}

// ── Report builder ───────────────────────────────────────────────────────────

function buildReport(
  incidentId: string,
  plan: HaremIntriguePlan,
  resolved: HaremIntrigueResolvedOutcome,
  observationLevel: HaremIntrigueObservationLevel,
  at: GameTime,
): HaremIntrigueReport {
  if (observationLevel === "exposed") {
    return {
      id: `ireport_${incidentId}`,
      source: { incidentId },
      reportKind: "exposure",
      createdAt: at,
      status: "unread",
      knownTargetIds: [plan.targetId],
      suspectedActorIds: [plan.actorId],
      suspectedKinds: [plan.kind],
      knownOutcome: resolved.success ? "harm_observed" : "attempt_observed",
      confidence: "confirmed",
      summaryCode: `exposure_${plan.kind}_${resolved.success ? "success" : "failed"}`,
    };
  }
  // anomaly — do not expose actor
  return {
    id: `ireport_${incidentId}`,
    source: { incidentId },
    reportKind: "anomaly",
    createdAt: at,
    status: "unread",
    knownTargetIds: [plan.targetId],
    suspectedActorIds: [],
    suspectedKinds: [],
    knownOutcome: resolved.success ? "harm_observed" : "attempt_observed",
    confidence: "tenuous",
    summaryCode: "anomaly_unexplained_harm",
  };
}

// ── Memory summary builders ──────────────────────────────────────────────────

function buildActorSecretSummary(
  plan: HaremIntriguePlan,
  outcome: HaremIntrigueResolvedOutcome,
): string {
  const kindLabel = INTRIGUE_KIND_LABELS[plan.kind];
  return outcome.success
    ? `对目标施以${kindLabel}，已奏效。`
    : `对目标施以${kindLabel}，未能成功。`;
}

function buildTargetConsequenceSummary(
  plan: HaremIntriguePlan,
  outcome: HaremIntrigueResolvedOutcome,
): string {
  const kindLabel = INTRIGUE_KIND_LABELS[plan.kind];
  if (outcome.discovered) {
    return outcome.success
      ? `被人以${kindLabel}所害，且已查明来源。`
      : `有人以${kindLabel}图谋加害，未能成功，已查明来源。`;
  }
  return outcome.success
    ? `遭遇不明的${kindLabel}之害。`
    : `有人以${kindLabel}图谋加害，未遂。`;
}

function buildTargetEmotions(
  outcome: HaremIntrigueResolvedOutcome,
): Partial<Record<"joy" | "grief" | "fear" | "anger" | "envy" | "shame" | "guilt" | "relief", number>> {
  if (outcome.discovered && outcome.success) return { anger: 70, fear: 30 };
  if (outcome.discovered && !outcome.success) return { anger: 50, relief: 40 };
  if (!outcome.discovered && outcome.success) return { grief: 40, fear: 20 };
  return { fear: 20 };
}

// ── Apply standing deltas ────────────────────────────────────────────────────

function applyStandingDeltas(
  state: GameState,
  deltas: HaremIntrigueResolvedOutcome["consequences"]["standing"],
): GameState {
  let standing = { ...state.standing };
  for (const delta of deltas) {
    const st = standing[delta.characterId];
    if (!st) continue;
    let updated = { ...st };
    if (delta.favor !== undefined) {
      const { favor, peakFavor } = applyFavorDelta(updated, delta.favor);
      updated = { ...updated, favor, peakFavor };
    }
    if (delta.affection !== undefined) {
      updated = { ...updated, affection: clamp((updated.affection ?? 50) + delta.affection, 0, 100) };
    }
    if (delta.fear !== undefined) {
      updated = { ...updated, fear: clamp((updated.fear ?? 30) + delta.fear, 0, 100) };
    }
    if (delta.loyalty !== undefined) {
      updated = { ...updated, loyalty: clamp((updated.loyalty ?? 50) + delta.loyalty, 0, 100) };
    }
    standing = { ...standing, [delta.characterId]: updated };
  }
  return { ...state, standing };
}

// ── Apply household deltas ────────────────────────────────────────────────────

function applyHouseholdDeltas(
  state: GameState,
  deltas: HaremIntrigueResolvedOutcome["consequences"]["household"],
): GameState {
  let standing = { ...state.standing };
  for (const delta of deltas) {
    const st = standing[delta.characterId];
    if (!st) continue;
    const hh = st.household;
    if (!hh) continue;
    const updatedHH = {
      servantOpinion: delta.servantOpinion !== undefined
        ? clamp(hh.servantOpinion + delta.servantOpinion, 0, 100)
        : hh.servantOpinion,
      livingStandard: delta.livingStandard !== undefined
        ? clamp(hh.livingStandard + delta.livingStandard, 0, 100)
        : hh.livingStandard,
      privateWealthLevel: delta.privateWealthLevel !== undefined
        ? clamp(hh.privateWealthLevel + delta.privateWealthLevel, 0, 100)
        : hh.privateWealthLevel,
    };
    standing = { ...standing, [delta.characterId]: { ...st, household: updatedHH } };
  }
  return { ...state, standing };
}

// ── Apply nation rumor delta ──────────────────────────────────────────────────

function applyNationRumor(state: GameState, rumorDelta: number | undefined): GameState {
  if (!rumorDelta) return state;
  const nation = state.resources.nation;
  return {
    ...state,
    resources: {
      ...state.resources,
      nation: { ...nation, rumor: clamp(nation.rumor + rumorDelta, 0, 100) },
    },
  };
}

// ── Append memory to character ────────────────────────────────────────────────

type MemoryDraft = Omit<import("../state/types").MemoryEntry, "id" | "ownerId" | "createdAt" | "triggerTags">;

function appendMemory(state: GameState, charId: string, draft: MemoryDraft, at: GameTime): GameState {
  const store = state.memories[charId];
  if (!store) return state;
  const newEntry: import("../state/types").MemoryEntry = {
    id: memoryEntryId(charId, store.nextSeq),
    ownerId: charId,
    kind: draft.kind,
    subjectIds: [...draft.subjectIds],
    perspective: draft.perspective,
    summary: draft.summary,
    strength: draft.strength,
    retention: draft.retention,
    emotions: { ...draft.emotions },
    triggerTags: [],
    unresolved: draft.unresolved,
    createdAt: at,
    ...(draft.sourceEventId !== undefined ? { sourceEventId: draft.sourceEventId } : {}),
  };
  return {
    ...state,
    memories: {
      ...state.memories,
      [charId]: {
        entries: [...store.entries, newEntry],
        nextSeq: store.nextSeq + 1,
      },
    },
  };
}

// ── Scheme ID builder ────────────────────────────────────────────────────────

function schemeId(plan: HaremIntriguePlan): string {
  return `scheme_${plan.year}_${String(plan.month).padStart(2, "0")}_${plan.actorId}_${plan.targetId}`;
}

// ── Main settlement function ──────────────────────────────────────────────────

export interface HaremIntrigueSettlementResult {
  state: GameState;
  newIncidents: HaremIncident[];
}

/**
 * 处理所有逾期 pending 宫斗阴谋，写入后果，规划下月阴谋。
 * 幂等：已完成期号直接返回当前 state。
 * 纯函数——入参 state 不被修改。
 */
export function settleHaremIntrigue(
  db: ContentDB,
  state: GameState,
  at: GameTime,
): Result<HaremIntrigueSettlementResult, GameError[]> {
  // A. 幂等检查
  const periodKey = settlementPeriodKey(at.year, at.month);
  if (state.settledHaremIntriguePeriods.includes(periodKey)) {
    return ok({ state, newIncidents: [] });
  }

  let next = state;
  const newIncidents: HaremIncident[] = [];

  // B. 找出所有逾期 pending schemes（包括过去未处理月份），按年月/sourceKey/id 排序
  const currentOrdinal = monthOrdinal(at.year, at.month);
  const dueSchemes = next.haremSchemes
    .filter(
      (s) =>
        s.status === "pending" &&
        monthOrdinal(s.scheduledForYear, s.scheduledForMonth) <= currentOrdinal,
    )
    .sort((a, b) => {
      const ordDiff =
        monthOrdinal(a.scheduledForYear, a.scheduledForMonth) -
        monthOrdinal(b.scheduledForYear, b.scheduledForMonth);
      if (ordDiff !== 0) return ordDiff;
      if (a.sourceKey < b.sourceKey) return -1;
      if (a.sourceKey > b.sourceKey) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });

  for (const scheme of dueSchemes) {
    const plan = scheme.plan;
    const result = resolveIntrigueOutcome(db, next, plan, at);

    if (!result.ok) {
      // 合约违规（plan 校验失败）→ 整个 settlement 失败并回滚
      const detail = result.error.map((f) => f.message).join("; ");
      return err([stateError("INTRIGUE_SETTLEMENT_FAILED", `scheme ${scheme.id}: ${detail}`)]);
    }

    const outcome = result.value;

    if (outcome.status === "cancelled") {
      // 业务取消（actor/target 不可用）→ 取消 scheme，产生 incident（无后果）
      const incident: HaremIncident = {
        id: `incident_${scheme.id}`,
        schemeId: scheme.id,
        kind: plan.kind,
        actorId: plan.actorId,
        targetId: plan.targetId,
        success: false,
        observationLevel: "none",
        resolvedAt: at,
        consequencesApplied: false,
      };
      newIncidents.push(incident);
      next = {
        ...next,
        haremSchemes: next.haremSchemes.map((s) =>
          s.id === scheme.id ? { ...s, status: "cancelled" as const, outcome } : s,
        ),
        haremIncidents: [...next.haremIncidents, incident],
      };
      continue;
    }

    // outcome.status === "resolved"
    const resolved = outcome as HaremIntrigueResolvedOutcome;
    const observationLevel = deriveObservationLevel(resolved, plan);

    // C. 应用后果
    next = applyStandingDeltas(next, resolved.consequences.standing);
    next = applyHouseholdDeltas(next, resolved.consequences.household);
    next = applyNationRumor(next, resolved.consequences.nation.rumor);

    // D. Memory writes
    next = appendMemory(next, plan.actorId, {
      kind: "secret",
      summary: buildActorSecretSummary(plan, resolved),
      strength: 60,
      retention: "slow",
      subjectIds: [plan.actorId, plan.targetId],
      perspective: "actor",
      unresolved: !resolved.discovered,
      emotions: resolved.success ? { guilt: 20 } : { shame: 20 },
    }, at);

    // Target memory: only written when observationLevel reveals perceptible harm
    if (observationLevel === "exposed") {
      next = appendMemory(next, plan.targetId, {
        kind: "grievance",
        summary: buildTargetConsequenceSummary(plan, resolved),
        strength: resolved.success ? 55 : 30,
        retention: "slow",
        subjectIds: [plan.actorId],
        perspective: "witness",
        unresolved: true,
        emotions: buildTargetEmotions(resolved),
      }, at);
    } else if (observationLevel === "anomaly") {
      // Hidden but noticeable harm: generic memory, never reveals actor or kind
      next = appendMemory(next, plan.targetId, {
        kind: "episodic",
        summary: "近来似有人暗中算计，然无从查起。",
        strength: 40,
        retention: "slow",
        subjectIds: [plan.targetId],
        perspective: "witness",
        unresolved: false,
        emotions: { grief: 30, fear: 20 },
      }, at);
    }
    // observationLevel === "none" → no target memory (hidden and undetectable)

    // E. Exposed → CourtEvent（必须成功，否则 settlement 整体失败）
    let courtEventId: string | undefined;
    if (observationLevel === "exposed") {
      const appendResult = appendCourtEvent(next, {
        type: "intrigue_discovered",
        occurredAt: at,
        participants: [
          { charId: plan.actorId, role: "actor" },
          { charId: plan.targetId, role: "target" },
        ],
        payload: {
          kind: plan.kind,
          motive: plan.motive,
          success: resolved.success,
          schemeId: scheme.id,
        },
        publicity: { scope: "palace", persistence: "contemporaneous" },
        publicSalience: resolved.success ? 70 : 40,
        retention: "slow",
        tags: ["intrigue", plan.kind],
      });

      if (!appendResult.ok) {
        return err([stateError("INTRIGUE_SETTLEMENT_FAILED", `CourtEvent 追加失败: ${String(appendResult.error)}`)]);
      }
      next = appendResult.value.state;
      courtEventId = appendResult.value.event.id;

      // 更新 actor memory 的 sourceEventId
      const store = next.memories[plan.actorId];
      if (store && store.entries.length > 0) {
        const lastEntry = store.entries[store.entries.length - 1]!;
        if (lastEntry.ownerId === plan.actorId && lastEntry.kind === "secret") {
          const updated = { ...lastEntry, sourceEventId: courtEventId };
          next = {
            ...next,
            memories: {
              ...next.memories,
              [plan.actorId]: {
                entries: [...store.entries.slice(0, -1), updated],
                nextSeq: store.nextSeq,
              },
            },
          };
        }
      }
    }

    // F. 生成脱敏的 HaremIntrigueReport（observationLevel !== "none" 时）
    const incidentId = `incident_${scheme.id}`;
    if (observationLevel !== "none") {
      const report = buildReport(incidentId, plan, resolved, observationLevel, at);
      next = {
        ...next,
        haremIntrigueReports: [...next.haremIntrigueReports, report],
      };
    }

    // G. 更新 scheme 和 incident
    const incident: HaremIncident = {
      id: incidentId,
      schemeId: scheme.id,
      kind: plan.kind,
      actorId: plan.actorId,
      targetId: plan.targetId,
      success: resolved.success,
      observationLevel,
      resolvedAt: at,
      consequencesApplied: true,
      ...(courtEventId !== undefined ? { courtEventId } : {}),
    };
    newIncidents.push(incident);
    next = {
      ...next,
      haremSchemes: next.haremSchemes.map((s) =>
        s.id === scheme.id ? { ...s, status: "resolved" as const, outcome: resolved } : s,
      ),
      haremIncidents: [...next.haremIncidents, incident],
    };
  }

  // H. 规划下月阴谋
  const existingKeys = new Set(next.haremSchemes.map((s) => s.sourceKey));
  const nextMonthTime = nextMonthAt(at);
  const newPlan = planMonthlyHaremIntrigue(db, next, {
    at: nextMonthTime,
    existingSourceKeys: existingKeys,
  });

  if (newPlan) {
    const sid = schemeId(newPlan);
    const sourceKey = buildIntrigueSourceKey(newPlan.year, newPlan.month);
    const newScheme: HaremScheme = {
      id: sid,
      sourceKey,
      plan: newPlan,
      status: "pending",
      scheduledForYear: newPlan.year,
      scheduledForMonth: newPlan.month,
    };
    next = {
      ...next,
      haremSchemes: [...next.haremSchemes, newScheme],
    };
  }

  // I. 写入幂等期号键
  next = {
    ...next,
    settledHaremIntriguePeriods: [...next.settledHaremIntriguePeriods, periodKey],
  };

  return ok({ state: next, newIncidents });
}
