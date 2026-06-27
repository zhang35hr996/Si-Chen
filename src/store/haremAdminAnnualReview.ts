/**
 * 六宫年度例核（PR #76）。
 *
 * 触发窗口：month ≥ 7（仲夏，六月已过）的首次推进，或 month===6 && period==="late"。
 * 每年至多一条（hasHaremAdminReviewForYear 保证幂等）。
 * 三种结果：rank_changed / no_candidate / no_administrator。
 * 乘风被动禀报：acknowledged=false 时构成全局中断，玩家只有「知道了」。
 */
import { toGameTime } from "../engine/calendar/time";
import type { CalendarState } from "../engine/calendar/time";
import type { ContentDB } from "../engine/content/loader";
import { stateError, type GameError } from "../engine/infra/errors";
import { ok, err, type Result } from "../engine/infra/result";
import type {
  GameState,
  HaremAdminReviewRecord,
} from "../engine/state/types";
import {
  planAdministratorRankDecision,
  resolveHaremAdminRankCommand,
} from "./haremAdminCommands";

// 六月下旬（含）之后为例核窗口。
const REVIEW_MONTH = 6;

function makeReviewId(year: number): string {
  return `harem_admin_review_${year}`;
}

/** 当前日历是否处于例核触发窗口（六月下旬或七月以后）。 */
export function isHaremAdminReviewWindow(calendar: CalendarState): boolean {
  if (calendar.month > REVIEW_MONTH) return true;
  if (calendar.month === REVIEW_MONTH && calendar.period === "late") return true;
  return false;
}

/** 本年是否已有例核记录（幂等守卫）。 */
export function hasHaremAdminReviewForYear(state: GameState, year: number): boolean {
  return state.haremAdminReviews.some((r) => r.year === year);
}

/** 最早一条 acknowledged=false 的例核记录（构成中断的待禀报）。 */
export function oldestPendingHaremAdminReport(state: GameState): HaremAdminReviewRecord | null {
  return (
    state.haremAdminReviews
      .filter((r) => !r.acknowledged)
      .sort((a, b) => a.year - b.year)[0] ?? null
  );
}

/**
 * 六宫年度例核原子结算。
 * - 从 haremAdministration 解析当前主理人 ID。
 * - 委托 planAdministratorRankDecision 决策，resolve 执行。
 * - 无论成功与否，追加 HaremAdminReviewRecord（acknowledged=false）并返回新 state。
 * - 原子：任何失败均回滚（返回 err，不修改传入 state）。
 */
export function settleAnnualHaremAdminReview(
  db: ContentDB,
  state: GameState,
): Result<GameState, GameError[]> {
  const now = toGameTime(state.calendar);
  const year = state.calendar.year;
  const id = makeReviewId(year);

  const admin = state.haremAdministration;

  // neiwu_proxy 模式：无人主理，直接记录 no_administrator。
  if (admin.mode === "neiwu_proxy") {
    const record: HaremAdminReviewRecord = {
      id,
      year,
      outcome: "no_administrator",
      settledAt: now,
      acknowledged: false,
    };
    return ok({ ...state, haremAdminReviews: [...state.haremAdminReviews, record] });
  }

  // 解析主理人 ID。
  const administratorId =
    admin.mode === "empress"
      ? Object.keys(state.standing).find(
          (id) =>
            state.standing[id]!.rank === "huanghou" &&
            state.standing[id]!.lifecycle !== "deceased",
        ) ?? null
      : admin.charId;

  if (!administratorId) {
    // 没有皇后（理应由 neiwu_proxy 覆盖，但作保险）。
    const record: HaremAdminReviewRecord = {
      id,
      year,
      outcome: "no_administrator",
      settledAt: now,
      acknowledged: false,
    };
    return ok({ ...state, haremAdminReviews: [...state.haremAdminReviews, record] });
  }

  // 决策引擎：尝试选出候选。
  const planned = planAdministratorRankDecision(db, state, administratorId);

  if (!planned) {
    // 无合格候选。
    const record: HaremAdminReviewRecord = {
      id,
      year,
      outcome: "no_candidate",
      settledAt: now,
      acknowledged: false,
    };
    return ok({ ...state, haremAdminReviews: [...state.haremAdminReviews, record] });
  }

  // 执行位分变动（原子：resolve 失败则 err 回滚）。
  const resolved = resolveHaremAdminRankCommand(db, state, planned.command);
  if (!resolved.ok) {
    return err([stateError("HAREM_ADMIN_REVIEW_FAILED", "例核执行失败：" + String(resolved.error))]);
  }

  const afterRank = resolved.value.state;
  const record: HaremAdminReviewRecord = {
    id,
    year,
    outcome: "rank_changed",
    targetId: planned.decision.targetId,
    fromRankId: planned.decision.fromRankId,
    toRankId: planned.decision.toRankId,
    settledAt: now,
    acknowledged: false,
  };

  return ok({
    ...afterRank,
    haremAdminReviews: [...afterRank.haremAdminReviews, record],
  });
}
