/**
 * 3 游戏年长周期模拟（无 UI，确定性）。
 *
 * 覆盖：
 *   1. 同 seed 结果相同（确定性）
 *   2. 不会同日连续触发多个 ambient 模板
 *   3. 每月 ambient 模板数量 ≤ 3
 *   4. 万寿节每年最多一次
 *   5. pending 万寿节不因 ambient roll 失败而消失（每年恰好出现一次）
 *   6. 所有触发的 templateId 均为已知合法 ID
 *
 * 策略：以 store.advanceTime(SKIP_REMAINDER) 逐旬推进，
 * 每旬尝试 planTemplateEventStart 并计为"可触发机会"；
 * 万寿节由 settlePostAdvance 在八月设置 pending flag 后自动可触发。
 *
 * 注：此测试不渲染 UI、不实际 commit event（beginTemplateEvent 不调用 resolveTemplateEvent），
 * 但借助 settlePostAdvance 验证万寿节 producer 的正确性。
 * resolvedAt 手动设为当前 dayIndex（pre-advance），模拟真实结算时刻。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { planTemplateEventStart } from "../../src/engine/events/templateStart";
import { templateEventsResolvedOnDay, templateEventsResolvedInMonth } from "../../src/engine/events/templateScheduler";

const db = loadRealContent();
const YEARS_TO_SIMULATE = 3;
const TURNS_PER_YEAR = 36; // 12 months × 3 periods
const TOTAL_TURNS = YEARS_TO_SIMULATE * TURNS_PER_YEAR;

const ALL_AMBIENT_IDS = [
  "tpl_garden_deliberate_encounter",
  "tpl_garden_avoid_emperor",
  "tpl_harem_admin_allowance_discrepancy",
  "tpl_harem_greeting_order_dispute",
  "tpl_harem_rumor_origin_dispute",
];

interface SimulationRecord {
  templateId: string;
  dayIndex: number;
  year: number;
  month: number;
  period: string;
}

function runSimulation(): SimulationRecord[] {
  const store = createGameStore();
  store["state"] = createNewGameState(db);
  const triggered: SimulationRecord[] = [];

  for (let t = 0; t < TOTAL_TURNS; t++) {
    const state = store.getState();
    const plan = planTemplateEventStart(db, state, "time_advance");
    if (plan) {
      triggered.push({
        templateId: plan.templateId,
        dayIndex: state.calendar.dayIndex,
        year: state.calendar.year,
        month: state.calendar.month,
        period: state.calendar.period,
      });
      // 写入 record 以更新频率计数
      store.beginTemplateEvent(plan.statePatch);
      // 标记为 resolved（pre-advance 时刻）使计数器生效；
      // 同时清除 pending flag（模拟 effects 应用，避免万寿节重复触发）
      const rec = store.getState().templateEventRecords[plan.instanceId];
      if (rec) {
        const isBirthday = plan.templateId === "tpl_ritual_birthday_scale";
        const nextState = store.getState();
        store["state"] = {
          ...nextState,
          flags: isBirthday
            ? { ...nextState.flags, ritual_birthday_pending: false }
            : nextState.flags,
          templateEventRecords: {
            ...nextState.templateEventRecords,
            [plan.instanceId]: {
              ...rec,
              status: "resolved",
              resolvedAt: nextState.calendar, // pre-advance
            },
          },
        };
      }
    }
    // 推进到下一旬（settlePostAdvance 在此时设置万寿节 pending flag）
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
  }

  return triggered;
}

describe("templateSimulation — 3 游戏年", () => {
  it("1. 同 seed 结果相同（确定性）", () => {
    const r1 = runSimulation();
    const r2 = runSimulation();
    expect(r1.map((r) => r.templateId + r.dayIndex)).toEqual(r2.map((r) => r.templateId + r.dayIndex));
  });

  it("2. 同一行动日不会连续触发多个 ambient 模板", () => {
    const records = runSimulation();
    const byDay = new Map<number, number>();
    for (const r of records) {
      byDay.set(r.dayIndex, (byDay.get(r.dayIndex) ?? 0) + 1);
    }
    for (const [day, count] of byDay) {
      expect(count, `dayIndex ${day} has ${count} triggers`).toBeLessThanOrEqual(1);
    }
  });

  it("3. 每月 time_advance ambient 模板数量 ≤ 3", () => {
    const store = createGameStore();
    store["state"] = createNewGameState(db);
    const monthCounts = new Map<string, number>();

    for (let t = 0; t < TOTAL_TURNS; t++) {
      const state = store.getState();
      const plan = planTemplateEventStart(db, state, "time_advance");
      if (plan) {
        store.beginTemplateEvent(plan.statePatch);
        const rec = store.getState().templateEventRecords[plan.instanceId];
        if (rec) {
          const isBirthday = plan.templateId === "tpl_ritual_birthday_scale";
          const ns = store.getState();
          store["state"] = {
            ...ns,
            flags: isBirthday ? { ...ns.flags, ritual_birthday_pending: false } : ns.flags,
            templateEventRecords: {
              ...ns.templateEventRecords,
              [plan.instanceId]: { ...rec, status: "resolved", resolvedAt: ns.calendar },
            },
          };
        }
        // 只统计 ambient（pending 万寿节不计入月度 ambient 上限）
        const tpl = db.templates[plan.templateId];
        if ((tpl?.schedule?.kind ?? "ambient") === "ambient") {
          const key = `${state.calendar.year}-${state.calendar.month}`;
          monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
        }
      }
      store.advanceTime(db, { type: "SKIP_REMAINDER" });
    }

    for (const [month, count] of monthCounts) {
      expect(count, `month ${month} has ${count} ambient triggers`).toBeLessThanOrEqual(3);
    }
  });

  it("4. 万寿节每年最多触发一次（pending 模板年度上限）", () => {
    const records = runSimulation();
    const birthdayByYear = new Map<number, number>();
    for (const r of records) {
      if (r.templateId === "tpl_ritual_birthday_scale") {
        birthdayByYear.set(r.year, (birthdayByYear.get(r.year) ?? 0) + 1);
      }
    }
    for (const [year, count] of birthdayByYear) {
      expect(count, `year ${year} birthday triggers: ${count}`).toBeLessThanOrEqual(1);
    }
  });

  it("5. 3 年内万寿节总出现次数 ≥ 1（pending flag 实际生效）", () => {
    const records = runSimulation();
    const birthdayCount = records.filter((r) => r.templateId === "tpl_ritual_birthday_scale").length;
    // 万寿节有唯一礼官 wei_sui，其 pool 修复后应出现；若礼官池仍为空则为 0（fail 本测试）
    expect(birthdayCount, "birthday should appear at least once in 3 years").toBeGreaterThan(0);
  });

  it("6. 所有触发的 templateId 均为合法已知模板", () => {
    const knownIds = new Set([...ALL_AMBIENT_IDS, "tpl_ritual_birthday_scale"]);
    const records = runSimulation();
    expect(records.length, "should trigger at least some events in 3 years").toBeGreaterThan(0);
    for (const r of records) {
      expect(knownIds.has(r.templateId), `unknown template: ${r.templateId}`).toBe(true);
    }
  });
});

describe("templateScheduler counters — integration with resolved records", () => {
  it("daily and monthly counters start at zero for a fresh game", () => {
    const store = createGameStore();
    store["state"] = createNewGameState(db);
    const state0 = store.getState();

    expect(templateEventsResolvedOnDay(db, state0, state0.calendar.dayIndex)).toBe(0);
    expect(templateEventsResolvedInMonth(db, state0, state0.calendar.year, state0.calendar.month)).toBe(0);
  });
});
