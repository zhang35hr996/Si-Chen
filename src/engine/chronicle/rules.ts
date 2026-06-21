/**
 * 事件→记忆 编译规则（判别联合，两种事务语义显式分开）：
 * - record_after：变化由上游动作（set_rank/relocate/birth）完成；规则 validateTransition(before, after)
 *   证明「变化真发生」（不只验终态一致）；记忆从 after 派生。
 * - execute：无独立上游动作（heir_died）；规则 validate + worldEffects 由提交执行变化。
 * 规则只为有记忆库的角色（侍君）建记忆。
 */
import type { EventEffect } from "../content/schemas";
import { stateError, type GameError } from "../infra/errors";
import type { CourtEvent, CourtEventType, EmotionalCondition, GameState } from "../state/types";

export type EventMemoryDraft = Omit<CourtEvent, "id">;
export type EmotionalConditionDraft = Omit<EmotionalCondition, "id">;

interface BaseEventMemoryRule {
  createPersonalMemories(state: GameState, event: CourtEvent): EventEffect[];
  applyRelationshipEffects(state: GameState, event: CourtEvent): EventEffect[];
  applyConditions?(state: GameState, event: CourtEvent): EmotionalConditionDraft[];
}
export interface RecordAfterEventRule extends BaseEventMemoryRule {
  mode: "record_after";
  validateTransition(before: GameState, after: GameState, draft: EventMemoryDraft): GameError[];
}
export interface ExecuteEventRule extends BaseEventMemoryRule {
  mode: "execute";
  validate(state: GameState, draft: EventMemoryDraft): GameError[];
  worldEffects(state: GameState, draft: EventMemoryDraft): EventEffect[];
}
export type EventMemoryRule = RecordAfterEventRule | ExecuteEventRule;

function roleId(participants: { charId: string; role: string }[], role: string): string | undefined {
  return participants.find((p) => p.role === role)?.charId;
}
export function participantId(event: CourtEvent, role: string): string | undefined {
  return roleId(event.participants, role);
}

const rankChanged: RecordAfterEventRule = {
  mode: "record_after",
  // 证明降/晋位真的发生：before.rank===from ∧ after.rank===to ∧ from!==to。
  validateTransition(before, after, draft) {
    const errs: GameError[] = [];
    const subject = roleId(draft.participants, "subject");
    const { from, to, direction } = draft.payload;
    if (!subject || !before.standing[subject] || !after.standing[subject]) errs.push(stateError("RULE_BAD", "rank_changed needs 'subject' with standing in both states"));
    if (direction !== "demote" && direction !== "promote") errs.push(stateError("RULE_BAD", "rank_changed direction must be demote|promote"));
    if (typeof from !== "string" || typeof to !== "string") errs.push(stateError("RULE_BAD", "rank_changed payload.from/to missing"));
    else if (from === to) errs.push(stateError("RULE_BAD", "rank_changed from === to"));
    else if (subject && before.standing[subject] && after.standing[subject]) {
      if (before.standing[subject]!.rank !== from) errs.push(stateError("RULE_BAD", "before.rank !== payload.from"));
      if (after.standing[subject]!.rank !== to) errs.push(stateError("RULE_BAD", "after.rank !== payload.to"));
    }
    return errs;
  },
  createPersonalMemories(state, event) {
    const subject = participantId(event, "subject")!;
    if (!state.memories[subject]) return [];
    const demote = event.payload.direction === "demote";
    return [{
      type: "memory", char: subject,
      entry: {
        kind: demote ? "grievance" : "episodic",
        summary: demote ? "位分见黜，心有不甘。" : "蒙恩晋位。",
        strength: demote ? 70 : 55, retention: "slow",
        subjectIds: [subject], perspective: "target",
        triggerTags: demote ? ["rank", "demotion"] : ["rank", "promotion"],
        unresolved: demote, emotions: demote ? { shame: 60, anger: 50 } : { joy: 40 },
        sourceEventId: event.id,
      },
    }];
  },
  applyRelationshipEffects: () => [],
};

const residenceChanged: RecordAfterEventRule = {
  mode: "record_after",
  // 证明迁居真的发生：before.residence===from ∧ after.residence===to。
  validateTransition(before, after, draft) {
    const errs: GameError[] = [];
    const mover = roleId(draft.participants, "mover");
    const { from, to } = draft.payload;
    if (!mover || !before.standing[mover] || !after.standing[mover]) errs.push(stateError("RULE_BAD", "residence_changed needs 'mover' with standing in both states"));
    if (typeof to !== "string") errs.push(stateError("RULE_BAD", "residence_changed payload.to missing"));
    else if (mover && before.standing[mover] && after.standing[mover]) {
      if (before.standing[mover]!.residence !== from) errs.push(stateError("RULE_BAD", "before.residence !== payload.from"));
      if (after.standing[mover]!.residence !== to) errs.push(stateError("RULE_BAD", "after.residence !== payload.to"));
    }
    return errs;
  },
  createPersonalMemories(state, event) {
    const mover = participantId(event, "mover");
    if (!mover || !state.memories[mover]) return [];
    const to = typeof event.payload.to === "string" ? event.payload.to : (event.locationId ?? "");
    return [{
      type: "memory", char: mover,
      entry: {
        kind: "impression", summary: `迁居${to}。`, strength: 35, retention: "fast",
        subjectIds: [mover], perspective: "actor", triggerTags: ["residence"],
        unresolved: false, emotions: {}, sourceEventId: event.id,
      },
    }];
  },
  applyRelationshipEffects: () => [],
};

export const eventMemoryRules: Partial<Record<CourtEventType, EventMemoryRule>> = {
  rank_changed: rankChanged,
  residence_changed: residenceChanged,
};
