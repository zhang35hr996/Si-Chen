/**
 * 六宫行政位分处分命令层（皇后主理 / 代理侍君协理均走此层）。
 *
 * 皇后正常掌宫或代理侍君奉旨协理时，仅可调整贵人以下侍君的位分（晋封/降位），
 * 与皇帝直接敕封（rankOps + App.applyRankOp）保持来源区分：
 *   - 编年史 actor = 实际执行者（皇后 / 代理侍君），非 player
 *   - 台词与记忆文案按 office 使用对应模板，不归因于皇帝
 *   - 效果仍走同一 funnel，权限校验由 funnel.validateEffects 兜底
 */
import { toGameTime } from "../engine/calendar/time";
import {
  planAdministratorRankDecision as planDecision,
  type HaremAdminDecision,
} from "../engine/characters/haremAdminDecision";
import { canAdministratorAdjustRank, canEmpressAdjustRank } from "../engine/characters/haremRankAuthority";
import { resolveDisplayName } from "../engine/characters/standing";
import { appendCourtEvent } from "../engine/chronicle/append";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import { stateError, type GameError } from "../engine/infra/errors";
import { ok, err, type Result } from "../engine/infra/result";
import type { CourtEvent, GameState } from "../engine/state/types";
import { applyEffects } from "../engine/effects/funnel";
import { buildRankOp, type RankOpRequest } from "./rankOps";

export type HaremAdminRankCommand = {
  type: "harem_admin_rank_change";
  actorId: string;
  targetId: string;
  request: RankOpRequest;
};

export interface HaremAdminCommandPlan {
  effects: EventEffect[];
  chronicle: Omit<CourtEvent, "id">[];
  lines: string[];
}

export type HaremAdminCommandResult =
  | { ok: true; plan: HaremAdminCommandPlan }
  | { ok: false; reason: string };

/**
 * 自主决策完整结果：decision（含 reason/score）+ command + plan。
 * #73B 的 settlePostAdvance 用此类型持久化原因并生成乘风禀报台词，
 * 无需重新运行决策引擎或重新推断原因。
 */
export interface PlannedAutonomousRankDecision {
  decision: HaremAdminDecision;
  command: HaremAdminRankCommand;
  plan: HaremAdminCommandPlan;
}

/**
 * 校验并组装六宫行政位分处分命令。
 *
 * 校验在命令层（此处）和效果层（funnel）双重进行，保证：
 *   1. 即使 UI 绕过命令层直接构造效果，funnel 也拒绝；
 *   2. 命令层在写入效果前提前给出友好提示。
 */
export function planHaremAdminRankCommand(
  db: ContentDB,
  state: GameState,
  command: HaremAdminRankCommand,
): HaremAdminCommandResult {
  const { actorId, targetId, request } = command;

  // 封号操作须陛下亲旨，六宫主理者无权处置。
  if (request.kind !== "set_rank") {
    return { ok: false, reason: "皇后及六宫协理者无权处置封号，须由陛下亲旨。" };
  }

  const newRankId = request.rank;
  const office: "empress" | "acting_consort" = state.haremAdministration.mode === "empress" ? "empress" : "acting_consort";
  const check = office === "empress"
    ? canEmpressAdjustRank(db, state, actorId, targetId, newRankId)
    : canAdministratorAdjustRank(db, state, actorId, targetId, newRankId);
  if (!check.ok) return { ok: false, reason: check.reason };

  const authority = { kind: "harem_administrator" as const, actorId, office };
  const op = buildRankOp(db, state, targetId, request, authority);
  if (!op) return { ok: false, reason: "操作无效（位分未发生变化）。" };

  // chronicle
  const now = toGameTime(state.calendar);
  const actorChar = db.characters[actorId] ?? state.generatedConsorts[actorId];
  const actorSt = state.standing[actorId];
  const actorRankMeta = actorSt ? db.ranks[actorSt.rank] : undefined;
  const actorName = actorChar ? resolveDisplayName(actorChar, actorSt, actorRankMeta) : actorId;

  const fromRankId = state.standing[targetId]?.rank;
  const toRankId = request.rank;
  const fromTitle = state.standing[targetId]?.title;
  const toTitle = fromTitle;
  const operation = request.kind;

  const chronicle: Omit<CourtEvent, "id">[] = [
    {
      type: "rank_changed",
      occurredAt: now,
      participants: [
        { charId: actorId, role: "administrator" },
        { charId: targetId, role: op.kind === "promote" || op.kind === "grant_title" ? "recipient" : "demoted" },
      ],
      payload: {
        decree: "harem_administration_rank_change",
        actorId,
        actorName,
        targetId,
        fromRankId,
        toRankId,
        fromTitle,
        toTitle,
        operation,
        direction: op.kind === "promote" || op.kind === "grant_title" ? "promotion" : "demotion",
      },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 60,
      retention: "slow",
      tags: ["harem_administration", "rank_change", op.kind],
    },
  ];

  return { ok: true, plan: { effects: op.effects, chronicle, lines: op.lines } };
}

/**
 * 纯 resolver：校验 → applyEffects → chronicle，返回最终 state 和 plan。
 * 不修改 GameStore，不 emit。供 settlePostAdvance 内的事务使用。
 */
export function resolveHaremAdminRankCommand(
  db: ContentDB,
  state: GameState,
  command: HaremAdminRankCommand,
): Result<{ state: GameState; plan: HaremAdminCommandPlan }, GameError[]> {
  const planned = planHaremAdminRankCommand(db, state, command);
  if (!planned.ok) {
    return err([stateError("HAREM_ADMIN_RANK_REJECTED", planned.reason)]);
  }
  const plan = planned.plan;

  const applied = applyEffects(db, state, plan.effects);
  if (!applied.ok) return err(applied.error);
  let candidate = applied.value;

  for (const draft of plan.chronicle) {
    const ap = appendCourtEvent(candidate, draft);
    if (!ap.ok) return err(ap.error);
    candidate = ap.value.state;
  }

  return ok({ state: candidate, plan });
}

/**
 * 自主位分决策：委托决策引擎，将结果包装为 PlannedAutonomousRankDecision。
 * 返回 null 表示无合格目标、无权限、或引擎权限复验失败（理应不出现）。
 * #73B 的 settlePostAdvance 直接消费此函数的返回值。
 */
export function planAdministratorRankDecision(
  db: ContentDB,
  state: GameState,
  administratorId: string,
): PlannedAutonomousRankDecision | null {
  const decision = planDecision(db, state, administratorId);
  if (!decision) return null;
  const command: HaremAdminRankCommand = {
    type: "harem_admin_rank_change",
    actorId: decision.actorId,
    targetId: decision.targetId,
    request: { kind: "set_rank", rank: decision.toRankId },
  };
  const cmdResult = planHaremAdminRankCommand(db, state, command);
  if (!cmdResult.ok) return null;
  return { decision, command, plan: cmdResult.plan };
}
