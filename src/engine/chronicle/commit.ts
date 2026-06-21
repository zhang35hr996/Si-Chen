/**
 * 客观事件提交（原子，全程 Result）。两种入口对应两种事务语义：
 * - recordCourtEvent：record_after 规则。调用者已用上游动作改好状态，传 before/after 两态；
 *   validateTransition 证明变化真发生 → append（到 after）→ 派生记忆/情绪。
 * - executeCourtEvent：execute 规则。validate → worldEffects（执行变化）→ append → 派生。
 * 任一子步失败整批回退，调用方保留原 state。
 */
import { appendCourtEvent } from "./append";
import { appendCondition } from "./conditions";
import { eventMemoryRules, type EventMemoryDraft, type EventMemoryRule } from "./rules";
import type { ContentDB } from "../content/loader";
import { applyEffects } from "../effects/funnel";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { CourtEvent, GameState } from "../state/types";

/** append 之后：把规则的记忆/关系效果经漏斗应用，再 append 情绪状态。 */
function deriveMemoriesAndConditions(
  db: ContentDB, state: GameState, event: CourtEvent, rule: EventMemoryRule,
): Result<GameState, GameError[]> {
  let cur = state;
  const effects = [...rule.createPersonalMemories(cur, event), ...rule.applyRelationshipEffects(cur, event)];
  if (effects.length > 0) {
    const a = applyEffects(db, cur, effects);
    if (!a.ok) return err(a.error);
    cur = a.value;
  }
  for (const cd of rule.applyConditions?.(cur, event) ?? []) cur = appendCondition(cur, cd);
  return ok(cur);
}

export function recordCourtEvent(
  db: ContentDB, before: GameState, after: GameState, draft: EventMemoryDraft,
): Result<{ state: GameState; event: CourtEvent }, GameError[]> {
  const rule = eventMemoryRules[draft.type];
  if (!rule || rule.mode !== "record_after") return err([stateError("RULE_MODE", `${draft.type} is not a record_after event`)]);
  const vErrs = rule.validateTransition(before, after, draft);
  if (vErrs.length > 0) return err(vErrs);
  const appended = appendCourtEvent(after, draft);
  if (!appended.ok) return err(appended.error);
  const derived = deriveMemoriesAndConditions(db, appended.value.state, appended.value.event, rule);
  return derived.ok ? ok({ state: derived.value, event: appended.value.event }) : err(derived.error);
}

export function executeCourtEvent(
  db: ContentDB, state: GameState, draft: EventMemoryDraft,
): Result<{ state: GameState; event: CourtEvent }, GameError[]> {
  const rule = eventMemoryRules[draft.type];
  if (!rule || rule.mode !== "execute") return err([stateError("RULE_MODE", `${draft.type} is not an execute event`)]);
  const vErrs = rule.validate(state, draft);
  if (vErrs.length > 0) return err(vErrs);
  let cur = state;
  const we = rule.worldEffects(state, draft);
  if (we.length > 0) {
    const a = applyEffects(db, cur, we);
    if (!a.ok) return err(a.error);
    cur = a.value;
  }
  const appended = appendCourtEvent(cur, draft);
  if (!appended.ok) return err(appended.error);
  const derived = deriveMemoriesAndConditions(db, appended.value.state, appended.value.event, rule);
  return derived.ok ? ok({ state: derived.value, event: appended.value.event }) : err(derived.error);
}
