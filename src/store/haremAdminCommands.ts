/**
 * 六宫行政位分处分命令层。
 *
 * 代理侍君对低位侍君进行的晋封/降位/赐封号/褫封号走此命令层，
 * 与皇帝直接敕封（rankOps + App.applyRankOp）保持来源区分：
 *   - 编年史 actor = 代理侍君，非 player
 *   - 记忆文案记录代理侍君，非"陛下"
 *   - 效果仍走同一 funnel，权限校验由 funnel.validateEffects 兜底
 */
import { toGameTime } from "../engine/calendar/time";
import { canAdministratorAdjustRank, canEmpressAdjustRank } from "../engine/characters/haremRankAuthority";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { CourtEvent, GameState } from "../engine/state/types";
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

  // 校验访问权（rank 约束仅 set_rank 时需要检查新位分；title 操作只检查目标访问权）。
  const newRankId =
    request.kind === "set_rank" ? request.rank : (state.standing[targetId]?.rank ?? "");
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
  const toRankId = request.kind === "set_rank" ? request.rank : fromRankId;
  const fromTitle = state.standing[targetId]?.title;
  const toTitle = request.kind === "set_title" ? request.title : request.kind === "remove_title" ? undefined : fromTitle;
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
 * 协理者自主晋降决策占位符（第二阶段实现，基于性格/关系/恩宠）。
 * 现阶段返回 null，调用方跳过。
 */
export function planAdministratorRankDecision(
  _db: ContentDB,
  _state: GameState,
  _administratorId: string,
): HaremAdminCommandResult | null {
  return null;
}
