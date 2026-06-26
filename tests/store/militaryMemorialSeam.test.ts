/**
 * Group H: Store integration via real time advance to month 7 (military assessment seam).
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import {
  generateMilitaryMemorial,
  getPendingMemorials,
  resolveMemorial,
  validateMemorials,
} from "../../src/engine/court/memorials";
import { validateFrontierAssessments, theaterForYear } from "../../src/engine/court/frontierAssessment";
import type { FrontierAssessmentPlan } from "../../src/engine/court/frontierAssessment";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** Create a store advanced to just before month 7 (month 6, late, 1 AP). */
function storeAtMonth6Late(year = 1): GameStore {
  const store = new GameStore();
  const s = createNewGameState(db, 1);
  store.loadState({
    ...s,
    calendar: {
      ...s.calendar,
      year,
      month: 6,
      period: "late" as const,
      dayIndex: dayIndexOf(year, 6, "late"),
      ap: 1,
    },
  });
  return store;
}

// ── Basic seam ────────────────────────────────────────────────────────────────

describe("Group H: military memorial seam — advancing to month 7", () => {
  it("advancing to month 7: frontierAssessments has 1 entry", () => {
    const store = storeAtMonth6Late(1);
    expect(store.getState().frontierAssessments).toHaveLength(0);

    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.month).toBe(7);
    expect(store.getState().frontierAssessments).toHaveLength(1);
  });

  it("borderPressure updated after advancement to month 7", () => {
    const store = storeAtMonth6Late(1);
    const before = store.getState().resources.nation.borderPressure;
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const after = store.getState().resources.nation.borderPressure;
    const assessment = store.getState().frontierAssessments[0]!;
    // borderPressure should equal pressureAfter in the assessment
    expect(after).toBe(assessment.pressureAfter);
  });

  it("a military memorial is generated in state.memorials", () => {
    const store = storeAtMonth6Late(1);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const militaryMemorials = getPendingMemorials(store.getState()).filter(
      (m) => m.category === "military",
    );
    expect(militaryMemorials).toHaveLength(1);
    expect(validateMemorials(store.getState())).toEqual([]);
  });

  it("assessment theater ID matches theaterForYear", () => {
    const store = storeAtMonth6Late(1);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const assessment = store.getState().frontierAssessments[0]!;
    expect(assessment.theaterId).toBe(theaterForYear(1));
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("Group H: military memorial seam — idempotency", () => {
  it("advancing to month 7 again (same year): still 1 assessment", () => {
    const store = storeAtMonth6Late(1);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().calendar.month).toBe(7);
    const count1 = store.getState().frontierAssessments.length;

    // Advance within month 7 again
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    const count2 = store.getState().frontierAssessments.length;
    expect(count2).toBe(count1); // same count, no duplicate
  });

  it("advancing to next year's month 7: 2 assessments (after resolving year 1 memorial)", () => {
    const store = storeAtMonth6Late(1);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().frontierAssessments).toHaveLength(1);

    // Resolve the pending military memorial so year 2 can generate one
    const m = getPendingMemorials(store.getState()).find((mm) => mm.category === "military")!;
    expect(m).toBeDefined();
    store.resolveMemorial(db, m.id, "defer_readiness");

    // Advance to year 2, month 7
    const s = store.getState();
    store.loadState({
      ...s,
      calendar: {
        ...s.calendar,
        year: 2,
        month: 6,
        period: "late" as const,
        dayIndex: dayIndexOf(2, 6, "late"),
        ap: 1,
      },
    });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().calendar.month).toBe(7);
    expect(store.getState().frontierAssessments).toHaveLength(2);
  });

  it("frontier assessments validate successfully after seam", () => {
    const store = storeAtMonth6Late(1);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(validateFrontierAssessments(store.getState())).toEqual([]);
  });
});

// ── Blocking by pending military memorial ─────────────────────────────────────

describe("Group H: military memorial seam — blocked_by_pending", () => {
  it("pending military from year 1 causes year 2 assessment to have blocked_by_pending", () => {
    const store = storeAtMonth6Late(1);
    // Advance to year 1 month 7 → generates military memorial (pending)
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().frontierAssessments[0]!.generation.status).toBe("generated");

    // Do NOT resolve the pending military memorial
    // Advance to year 2 month 7
    const s = store.getState();
    store.loadState({
      ...s,
      calendar: {
        ...s.calendar,
        year: 2,
        month: 6,
        period: "late" as const,
        dayIndex: dayIndexOf(2, 6, "late"),
        ap: 1,
      },
    });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    expect(store.getState().frontierAssessments).toHaveLength(2);
    const assessment2 = store.getState().frontierAssessments[1]!;
    expect(assessment2.year).toBe(2);
    expect(assessment2.generation.status).toBe("blocked_by_pending");
  });

  it("after resolving year 1 memorial, year 2 can generate its own memorial", () => {
    const store = storeAtMonth6Late(1);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const m1 = getPendingMemorials(store.getState()).find((m) => m.category === "military")!;
    expect(m1).toBeDefined();
    // Resolve year 1 memorial
    const r = store.resolveMemorial(db, m1.id, "defer_readiness");
    expect(r.ok).toBe(true);

    // Advance to year 2, month 7
    const s = store.getState();
    store.loadState({
      ...s,
      calendar: {
        ...s.calendar,
        year: 2,
        month: 6,
        period: "late" as const,
        dayIndex: dayIndexOf(2, 6, "late"),
        ap: 1,
      },
    });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const assessment2 = store.getState().frontierAssessments[1]!;
    expect(assessment2.generation.status).toBe("generated");
  });
});
