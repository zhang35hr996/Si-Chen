/** 候补池年度推进 + 科举经时间事务触发（Phase 3 PR3A）。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import {
  CANDIDATE_ELIGIBLE_YEARS,
  buildCandidateYearlyTick,
  getEligibleOfficialCandidates,
  hasGeneratedExaminationForYear,
  settleAnnualExamination,
} from "../../src/engine/officials/examination";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import type { GameState } from "../../src/engine/state/types";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed");
const db = content.value;
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

function runExamYears(seed: number, upto: number): GameState {
  let s = createNewGameState(db, seed);
  for (let y = 1; y <= upto; y++) s = settleAnnualExamination(s, db, y, at(y));
  return s;
}

describe("buildCandidateYearlyTick — survival/exit", () => {
  it("eligible age +1; expires after the eligibility window; non-eligible frozen", () => {
    let s = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1)); // year-1 cohort
    const id = Object.keys(s.officialCandidates)[0]!;
    const startAge = s.officialCandidates[id]!.age;
    // 推进到有效期满（year = examinationYear + ELIGIBLE_YEARS）。
    for (let y = 2; y <= 1 + CANDIDATE_ELIGIBLE_YEARS; y++) s = buildCandidateYearlyTick(s, y);
    const c = s.officialCandidates[id]!;
    expect(c.age).toBe(startAge + CANDIDATE_ELIGIBLE_YEARS);
    expect(c.status).toBe("expired");
    // 再 tick 不改变已退出者。
    const frozen = buildCandidateYearlyTick(s, 99).officialCandidates[id]!;
    expect(frozen).toEqual(c);
  });
});

describe("seed sweep — candidate world stays valid across many years", () => {
  it("validateOfficialWorld + schema clean for seeds 1..30 over 20 exam years", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = runExamYears(seed, 20);
      const errs = validateOfficialWorld(s, db);
      if (errs.length) throw new Error(`seed ${seed}: ${errs.map((e) => e.code).join(",")}`);
      expect(gameStateSchema.safeParse(s).success).toBe(true);
      // eligible 一律未过期；expired/withdrawn 不在 eligible 池。
      for (const c of getEligibleOfficialCandidates(s)) expect(20).toBeLessThan(c.expiresAtYear);
    }
  });

  it("eventually expires and (some years) withdraws cohorts; pool count is the eligible set", () => {
    const s = runExamYears(5, 20);
    expect(Object.values(s.officialCandidates).some((c) => c.status === "expired")).toBe(true);
    expect(getEligibleOfficialCandidates(s).every((c) => c.status === "eligible")).toBe(true);
  });
});

describe("annual examination fires through the time transaction", () => {
  /** 把状态摆到某年一月下旬、余 1 AP，使一次推进滚入二月。 */
  function storeBeforeFeb(year: number): GameStore {
    const s = createNewGameState(db, 9);
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year, month: 1, period: "late", dayIndex: dayIndexOf(year, 1, "late"), ap: 1 } });
    return store;
  }

  it("crossing into 二月 generates that year's exam exactly once (idempotent on further moves)", () => {
    const store = storeBeforeFeb(1);
    expect(hasGeneratedExaminationForYear(store.getState(), 1)).toBe(false);
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.month).toBe(2);
    expect(hasGeneratedExaminationForYear(store.getState(), 1)).toBe(true);
    const count = getEligibleOfficialCandidates(store.getState()).length;
    expect(count).toBeGreaterThanOrEqual(4);
    // 二月内再行动不重复生成。
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    expect(store.getState().examinationResults.filter((e) => e.year === 1)).toHaveLength(1);
    expect(getEligibleOfficialCandidates(store.getState()).length).toBe(count);
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });

  it("catch-up: entering past 二月 without prior generation still generates once", () => {
    const s = createNewGameState(db, 3);
    const store = new GameStore();
    // 直接摆到三月上旬之前（二月下旬末），未生成本年科举。
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 2, period: "late", dayIndex: dayIndexOf(1, 2, "late"), ap: 1 }, examinationResults: [] });
    expect(hasGeneratedExaminationForYear(store.getState(), 1)).toBe(false);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // → 三月上旬
    expect(store.getState().calendar.month).toBe(3);
    expect(hasGeneratedExaminationForYear(store.getState(), 1)).toBe(true);
  });
});
