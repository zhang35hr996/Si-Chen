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
 */
import type { CourtEvent } from "../state/types";
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
      return undefined;

    default: {
      // 穷举保护（新增 CourtEventType 时编译器提示）
      const _exhaustive: never = event.type;
      void _exhaustive;
      return undefined;
    }
  }
}
