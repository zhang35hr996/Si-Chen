/**
 * 月度宫斗 settlement（Phase 5A-2）。
 *
 * 执行当月 due 的 pending schemes：
 *   1. 解析结果（resolveIntrigueOutcome）
 *   2. 应用 standing / household / nation 后果
 *   3. 写入 actor 秘密记忆 + target 后果记忆
 *   4. 若 discovered → 追加 CourtEvent + IntrigueNotification
 *   5. 规划下月阴谋
 *
 * 所有入参均不被修改（结构化克隆或扩展运算符产生新对象）。
 */
import type { ContentDB } from "../content/loader";
import type {
  GameState,
  HaremScheme,
  HaremIncident,
  IntrigueNotification,
} from "../state/types";
import type { GameTime } from "../calendar/time";
import { makeGameTime } from "../calendar/time";
import { appendCourtEvent } from "../chronicle/append";
import { applyFavorDelta } from "./favor";
import { memoryEntryId } from "../state/newGame";
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

// ── Label maps ───────────────────────────────────────────────────────────────

const INTRIGUE_KIND_LABELS: Record<HaremIntrigueKind, string> = {
  slander: "谗言中伤",
  false_accusation: "诬陷构罪",
  steal_credit: "窃占功劳",
  faction_pressure: "派系施压",
  servant_subversion: "收买宫人",
};

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
    if (!hh) continue; // 无 household 记录则跳过
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
  if (!store) return state; // 角色无 memories 记录则跳过（官员等）
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
 * 处理当月 due 的 pending 宫斗阴谋，写入后果，规划下月阴谋。
 * 纯函数——入参 state 不被修改。
 */
export function settleHaremIntrigue(
  db: ContentDB,
  state: GameState,
  at: GameTime,
): HaremIntrigueSettlementResult {
  let next = state;
  const newIncidents: HaremIncident[] = [];

  // A. 找出本月 due 的 pending schemes
  const dueSchemes = next.haremSchemes.filter(
    (s) =>
      s.status === "pending" &&
      s.scheduledForYear === at.year &&
      s.scheduledForMonth === at.month,
  );

  for (const scheme of dueSchemes) {
    const plan = scheme.plan;
    const result = resolveIntrigueOutcome(db, next, plan, at);

    if (!result.ok) {
      // 合约违规 → 取消 scheme，不产生 incident
      next = {
        ...next,
        haremSchemes: next.haremSchemes.map((s) =>
          s.id === scheme.id ? { ...s, status: "cancelled" as const } : s,
        ),
      };
      continue;
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
        discovered: false,
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

    // B. 应用后果
    next = applyStandingDeltas(next, resolved.consequences.standing);
    next = applyHouseholdDeltas(next, resolved.consequences.household);
    next = applyNationRumor(next, resolved.consequences.nation.rumor);

    // C. Memory writes
    // Actor secret memory
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

    // Target consequence memory
    next = appendMemory(next, plan.targetId, {
      kind: resolved.discovered ? "grievance" : "episodic",
      summary: buildTargetConsequenceSummary(plan, resolved),
      strength: resolved.success ? 55 : 30,
      retention: "slow",
      subjectIds: resolved.discovered ? [plan.targetId, plan.actorId] : [plan.targetId],
      perspective: "witness",
      unresolved: resolved.discovered,
      emotions: buildTargetEmotions(resolved),
    }, at);

    // D. Discovered → CourtEvent + notification
    let discoveredEventId: string | undefined;
    if (resolved.discovered) {
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

      if (appendResult.ok) {
        next = appendResult.value.state;
        discoveredEventId = appendResult.value.event.id;
      }

      // E. Pending notification
      const notification: IntrigueNotification = {
        id: `inotif_${scheme.id}`,
        schemeId: scheme.id,
        kind: plan.kind,
        actorId: plan.actorId,
        targetId: plan.targetId,
        success: resolved.success,
        createdAt: at,
        dismissed: false,
      };
      next = {
        ...next,
        pendingIntrigueNotifications: [...next.pendingIntrigueNotifications, notification],
      };

      // Update actor memory with event link if available
      if (discoveredEventId) {
        const store = next.memories[plan.actorId];
        if (store && store.entries.length > 0) {
          const lastEntry = store.entries[store.entries.length - 1]!;
          if (lastEntry.ownerId === plan.actorId && lastEntry.kind === "secret") {
            const updated = { ...lastEntry, sourceEventId: discoveredEventId };
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
    }

    // Update scheme record
    const incident: HaremIncident = {
      id: `incident_${scheme.id}`,
      schemeId: scheme.id,
      kind: plan.kind,
      actorId: plan.actorId,
      targetId: plan.targetId,
      success: resolved.success,
      discovered: resolved.discovered,
      resolvedAt: at,
      consequencesApplied: true,
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

  // F. 规划下月阴谋
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

  return { state: next, newIncidents };
}
