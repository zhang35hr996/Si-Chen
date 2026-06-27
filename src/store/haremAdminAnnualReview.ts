/**
 * 六宫年度例核（PR #76）。
 *
 * 触发窗口：month ≥ 7（仲夏，六月已过）的首次推进，或 month===6 && period==="late"。
 * 每年至多一条（hasHaremAdminReviewForYear 保证幂等；函数本身也自检）。
 * 三种结果：
 *   rank_changed      — 位分变动，acknowledged=false，构成乘风全局中断
 *   no_candidate      — 无合格候选，acknowledged=true（仅幂等标记，不打断玩家）
 *   no_administrator  — neiwu_proxy 模式，acknowledged=true（同上）
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

/**
 * 最早一条 `outcome === "rank_changed" && acknowledged=false` 的例核记录。
 * no_candidate / no_administrator 直接 acknowledged=true，不出现在此队列中。
 */
export function oldestPendingHaremAdminReport(state: GameState): HaremAdminReviewRecord | null {
  return (
    state.haremAdminReviews
      .filter((r) => r.outcome === "rank_changed" && !r.acknowledged)
      .sort((a, b) => a.year - b.year)[0] ?? null
  );
}

/**
 * 六宫年度例核原子结算。
 *
 * 自检：
 *   - 不在触发窗口 → 直接返回 ok(state)
 *   - 本年已有记录 → 直接返回 ok(state)（幂等）
 *
 * 执行流程：
 *   1. 解析当前主理人 ID（empress/acting_consort）
 *   2. neiwu_proxy / 无皇后 → no_administrator（acknowledged=true）
 *   3. 决策引擎返回 null → no_candidate（acknowledged=true）
 *   4. 决策引擎返回结果 → 原子执行 resolveHaremAdminRankCommand
 *      - resolver 失败 → 返回 err（回滚，不写 record）
 *      - resolver 成功 → rank_changed（acknowledged=false，保存完整 decision 快照）
 */
export function settleAnnualHaremAdminReview(
  db: ContentDB,
  state: GameState,
): Result<GameState, GameError[]> {
  // 自检：触发窗口
  if (!isHaremAdminReviewWindow(state.calendar)) {
    return ok(state);
  }
  // 自检：本年幂等
  if (hasHaremAdminReviewForYear(state, state.calendar.year)) {
    return ok(state);
  }

  const now = toGameTime(state.calendar);
  const year = state.calendar.year;
  const id = makeReviewId(year);
  const admin = state.haremAdministration;

  // neiwu_proxy 模式：无人主理。
  if (admin.mode === "neiwu_proxy") {
    const record: HaremAdminReviewRecord = {
      id, year, outcome: "no_administrator", settledAt: now, acknowledged: true,
    };
    return ok({ ...state, haremAdminReviews: [...state.haremAdminReviews, record] });
  }

  // 解析主理人 ID。
  const administratorId =
    admin.mode === "empress"
      ? (Object.keys(state.standing).find(
          (cid) =>
            state.standing[cid]!.rank === "huanghou" &&
            state.standing[cid]!.lifecycle !== "deceased",
        ) ?? null)
      : admin.charId;

  if (!administratorId) {
    const record: HaremAdminReviewRecord = {
      id, year, outcome: "no_administrator", settledAt: now, acknowledged: true,
    };
    return ok({ ...state, haremAdminReviews: [...state.haremAdminReviews, record] });
  }

  const office: "empress" | "acting_consort" = admin.mode === "empress" ? "empress" : "acting_consort";

  // 决策引擎。
  const planned = planAdministratorRankDecision(db, state, administratorId);

  if (!planned) {
    const record: HaremAdminReviewRecord = {
      id, year, outcome: "no_candidate", settledAt: now, acknowledged: true,
    };
    return ok({ ...state, haremAdminReviews: [...state.haremAdminReviews, record] });
  }

  // 原子执行。
  const resolved = resolveHaremAdminRankCommand(db, state, planned.command);
  if (!resolved.ok) {
    return err([stateError("HAREM_ADMIN_REVIEW_FAILED", "例核执行失败：" + JSON.stringify(resolved.error))]);
  }

  const afterRank = resolved.value.state;
  const record: HaremAdminReviewRecord = {
    id,
    year,
    outcome: "rank_changed",
    administratorId,
    office,
    decision: {
      targetId: planned.decision.targetId,
      direction: planned.decision.direction,
      fromRankId: planned.decision.fromRankId,
      toRankId: planned.decision.toRankId,
      reason: planned.decision.reason,
      score: planned.decision.score,
    },
    settledAt: now,
    acknowledged: false,
  };

  return ok({
    ...afterRank,
    haremAdminReviews: [...afterRank.haremAdminReviews, record],
  });
}
