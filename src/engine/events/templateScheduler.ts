/**
 * 模板事件调度器：概率门 + 频率上限（不写 GameState，调度信息仅走 trace）。
 *
 * 策略：
 *   time_advance   → 30% ambient 触发率；同一行动日最多 1 个 ambient；同月最多 3 个 ambient
 *   location_enter → 100%（子地点主动点击，已有 eligible 就触发）
 *   pending 模板   → 100%，不参与概率门，不计入 ambient 月度上限
 */
import type { GameState } from "../state/types";
import type { RngFn } from "./templateEngine";
import type { Checkpoint } from "./engine";

export interface TemplateSchedulePolicy {
  checkpoint: Checkpoint;
  triggerChance: number;
  maxAmbientPerDay: number;
  maxAmbientPerMonth: number;
}

const POLICIES: Partial<Record<Checkpoint, TemplateSchedulePolicy>> = {
  time_advance:   { checkpoint: "time_advance",   triggerChance: 0.30, maxAmbientPerDay: 1, maxAmbientPerMonth: 3 },
  location_enter: { checkpoint: "location_enter", triggerChance: 1.00, maxAmbientPerDay: 99, maxAmbientPerMonth: 99 },
};

function getPolicy(checkpoint: Checkpoint): TemplateSchedulePolicy {
  return POLICIES[checkpoint] ?? { checkpoint, triggerChance: 0, maxAmbientPerDay: 0, maxAmbientPerMonth: 0 };
}

/** 当日已 resolved 的 ambient 模板事件数量（从 records 派生，无额外 state）。 */
export function templateEventsResolvedOnDay(state: GameState, dayIndex: number): number {
  return Object.values(state.templateEventRecords).filter(
    (r) => r.status === "resolved" && r.resolvedAt !== undefined && r.resolvedAt.dayIndex === dayIndex,
  ).length;
}

/** 当月已 resolved 的 ambient 模板事件数量（从 records 派生）。 */
export function templateEventsResolvedInMonth(state: GameState, year: number, month: number): number {
  return Object.values(state.templateEventRecords).filter(
    (r) => r.status === "resolved" && r.resolvedAt !== undefined &&
           r.resolvedAt.year === year && r.resolvedAt.month === month,
  ).length;
}

export type SkipReason =
  | "pending_no_skip"
  | "ambient_roll_failed"
  | "daily_limit"
  | "monthly_limit"
  | "no_eligible_template";

/** 调度诊断（写 trace，不入 GameState）。 */
export interface ScheduleDiagnostic {
  checkpoint: Checkpoint;
  kind: "ambient" | "pending";
  probabilityRoll: number | null;
  skippedReason: SkipReason | null;
  passed: boolean;
}

/**
 * 决定是否为 ambient 模板触发。对 pending 模板调用时始终返回 true（并记录原因）。
 * @param kind  - 当前候选模板的 schedule.kind（缺省 "ambient"）
 * @param rng   - 与 planTemplateEventStart 同批的确定性 RNG
 */
export function shouldTriggerTemplate(
  state: GameState,
  checkpoint: Checkpoint,
  kind: "ambient" | "pending",
  rng: RngFn,
): { passed: boolean; diagnostic: ScheduleDiagnostic } {
  const policy = getPolicy(checkpoint);

  if (kind === "pending") {
    return {
      passed: true,
      diagnostic: { checkpoint, kind, probabilityRoll: null, skippedReason: "pending_no_skip", passed: true },
    };
  }

  // location_enter 子地点主动点击 → 100%，不受日/月上限（子地点已是主动选择）
  if (checkpoint === "location_enter") {
    return {
      passed: true,
      diagnostic: { checkpoint, kind, probabilityRoll: 1, skippedReason: null, passed: true },
    };
  }

  // 日上限
  const todayCount = templateEventsResolvedOnDay(state, state.calendar.dayIndex);
  if (todayCount >= policy.maxAmbientPerDay) {
    return {
      passed: false,
      diagnostic: { checkpoint, kind, probabilityRoll: null, skippedReason: "daily_limit", passed: false },
    };
  }

  // 月上限
  const monthCount = templateEventsResolvedInMonth(state, state.calendar.year, state.calendar.month);
  if (monthCount >= policy.maxAmbientPerMonth) {
    return {
      passed: false,
      diagnostic: { checkpoint, kind, probabilityRoll: null, skippedReason: "monthly_limit", passed: false },
    };
  }

  // 概率门
  const roll = rng();
  if (roll >= policy.triggerChance) {
    return {
      passed: false,
      diagnostic: { checkpoint, kind, probabilityRoll: roll, skippedReason: "ambient_roll_failed", passed: false },
    };
  }

  return {
    passed: true,
    diagnostic: { checkpoint, kind, probabilityRoll: roll, skippedReason: null, passed: true },
  };
}
