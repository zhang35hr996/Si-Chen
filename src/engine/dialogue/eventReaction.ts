/**
 * eventToReactionContext — 从 CourtEvent 派生「谁是事件反应的主角」(Task 2).
 *
 * 支持的可反应事件类型（与 planReaction/EventReactionContext 保持对齐）：
 *   rank_changed     → subject 角色 + payload.direction
 *   residence_changed→ mover 角色
 *   heir_born        → adoptive_father > birth_father（优先养父）
 *   heir_died        → adoptive_father > birth_father（优先养父）
 *
 * 其余 CourtEventType 返回 undefined（不触发反应流程）。
 *
 * selectReactionEvent — 从已知事件列表中选出本轮最应反应的一条 (Task 4).
 */
import type { CourtEvent, GameState } from "../state/types";
import type { EventReactionContext } from "./reactionTypes";

/** 事件反应有效期（天）：超过此值的事件不再触发新反应。 */
export const MAX_REACTION_AGE_DAYS = 3;

/**
 * 从 CourtEvent 推导 EventReactionContext。
 *
 * - 若事件类型不在可反应集合内，返回 undefined。
 * - 若所需参与者角色缺失，返回 undefined。
 * - 结果纯函数（相同输入 → 相同输出）。
 */
export function eventToReactionContext(event: CourtEvent): EventReactionContext | undefined {
  const findRole = (role: string): string | undefined =>
    event.participants.find((p) => p.role === role)?.charId;

  switch (event.type) {
    case "rank_changed": {
      const subjectId = findRole("subject");
      if (!subjectId) return undefined;
      const dir = event.payload["direction"];
      const direction = dir === "demote" || dir === "promote" ? dir : undefined;
      return { eventType: "rank_changed", subjectId, ...(direction ? { direction } : {}) };
    }

    case "residence_changed": {
      const subjectId = findRole("mover");
      if (!subjectId) return undefined;
      return { eventType: "residence_changed", subjectId };
    }

    case "heir_born":
    case "heir_died": {
      // adoptive_father 优先于 birth_father
      const subjectId = findRole("adoptive_father") ?? findRole("birth_father");
      if (!subjectId) return undefined;
      return { eventType: event.type, subjectId };
    }

    // 不可反应类型
    case "punished":
    case "rewarded":
    case "conflict":
    case "promise":
    case "secret_discovered":
    case "harem_administration_changed":
      return undefined;

    default: {
      // 穷举保护（新增 CourtEventType 时编译器提示）
      const _exhaustive: never = event.type;
      void _exhaustive;
      return undefined;
    }
  }
}

/**
 * 从发言者「已知事件」列表中选出本轮最应反应的一条 CourtEvent (Task 4).
 *
 * 资格条件（全部满足才可选）：
 *   1. sceneDirective 未设置（authored 场景禁止事件反应）
 *   2. 事件已发生：event.occurredAt.dayIndex <= currentDayIndex
 *   3. 事件未过期：currentDayIndex - event.occurredAt.dayIndex <= MAX_REACTION_AGE_DAYS
 *   4. eventToReactionContext(event) 返回非 undefined（可反应类型且参与者完整）
 *   5. 一次性去重：(speakerId, audienceId, eventId) 三元组不在 state.eventReactionLog 中
 *
 * 选优：在满足条件的事件中取最近者（occurredAt.dayIndex 降序，id 降序作为决胜局）。
 * 无满足条件的事件时返回 undefined。
 */
export function selectReactionEvent(args: {
  speakerId: string;
  audienceId: string;
  events: readonly CourtEvent[];
  chronicle: readonly CourtEvent[];
  state: GameState;
  currentDayIndex: number;
  sceneDirective?: string;
}): CourtEvent | undefined {
  const { speakerId, audienceId, events, state, currentDayIndex, sceneDirective } = args;

  // 1. authored 场景禁止事件反应
  if (sceneDirective !== undefined) return undefined;

  // 预构建已反应三元组集合（O(n) 查找）
  const reactedSet = new Set<string>(
    state.eventReactionLog.map((r) => `${r.speakerId}\0${r.audienceId}\0${r.eventId}`),
  );

  const eligible = events.filter((event) => {
    const { dayIndex } = event.occurredAt;

    // 2. 不在未来
    if (dayIndex > currentDayIndex) return false;

    // 3. 未超过有效期
    if (currentDayIndex - dayIndex > MAX_REACTION_AGE_DAYS) return false;

    // 4. 可反应类型且参与者完整
    if (eventToReactionContext(event) === undefined) return false;

    // 5. 一次性去重
    if (reactedSet.has(`${speakerId}\0${audienceId}\0${event.id}`)) return false;

    return true;
  });

  if (eligible.length === 0) return undefined;

  // 选优：dayIndex 降序，id 降序决胜
  eligible.sort((a, b) => {
    const dayDiff = b.occurredAt.dayIndex - a.occurredAt.dayIndex;
    if (dayDiff !== 0) return dayDiff;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });

  return eligible[0];
}
