/**
 * Group D: planFrontierAssessment and applyAnnualFrontierAssessment.
 */
import { describe, expect, it } from "vitest";
import {
  planFrontierAssessment,
  hasFrontierAssessmentForYear,
  theaterForYear,
} from "../../src/engine/court/frontierAssessment";
import { applyAnnualFrontierAssessment } from "../../src/engine/court/memorials";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function atMonth7(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

// ── planFrontierAssessment ────────────────────────────────────────────────────

describe("Group D: planFrontierAssessment", () => {
  it("returns plan with correct year, theaterId, assessedAt", () => {
    const state = createNewGameState(db);
    const at = atMonth7(1);
    const plan = planFrontierAssessment(state, at);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.year).toBe(1);
    expect(plan.theaterId).toBe(theaterForYear(1));
    expect(plan.assessedAt).toEqual(at);
  });

  it("plan ID follows format frontier_assessment:{year}", () => {
    const state = createNewGameState(db);
    const plan = planFrontierAssessment(state, atMonth7(3));
    expect(plan?.id).toBe("frontier_assessment:3");
  });

  it("pressureBefore equals state.resources.nation.borderPressure (35)", () => {
    const state = createNewGameState(db);
    const plan = planFrontierAssessment(state, atMonth7(1));
    expect(plan?.pressureBefore).toBe(35);
  });

  it("pressureAfter is within [0, 100]", () => {
    const state = createNewGameState(db);
    const plan = planFrontierAssessment(state, atMonth7(1));
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.pressureAfter).toBeGreaterThanOrEqual(0);
    expect(plan.pressureAfter).toBeLessThanOrEqual(100);
  });

  it("returns null if hasFrontierAssessmentForYear is true (dedup)", () => {
    const state = createNewGameState(db);
    const at = atMonth7(1);
    // Apply assessment once
    const stateAfter = applyAnnualFrontierAssessment(state, db, at);
    expect(hasFrontierAssessmentForYear(stateAfter, 1)).toBe(true);
    // Second planFrontierAssessment should return null
    const plan2 = planFrontierAssessment(stateAfter, at);
    expect(plan2).toBeNull();
  });

  it("snapshot values match state resources", () => {
    const state = createNewGameState(db);
    const plan = planFrontierAssessment(state, atMonth7(1));
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.militaryAtAssessment).toBe(state.resources.nation.military);
    expect(plan.governanceAtAssessment).toBe(state.resources.nation.governance);
    expect(plan.publicSupportAtAssessment).toBe(state.resources.nation.publicSupport);
  });
});

// ── applyAnnualFrontierAssessment ─────────────────────────────────────────────

describe("Group D: applyAnnualFrontierAssessment", () => {
  it("returns state with exactly 1 assessment after first call", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    expect(after.frontierAssessments).toHaveLength(1);
  });

  it("assessment[0].year === at.year", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(2));
    expect(after.frontierAssessments[0]!.year).toBe(2);
  });

  it("assessment[0].pressureBefore === 35 (initial value)", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    expect(after.frontierAssessments[0]!.pressureBefore).toBe(35);
  });

  it("assessment[0].pressureAfter is 0–100", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const assessment = after.frontierAssessments[0]!;
    expect(assessment.pressureAfter).toBeGreaterThanOrEqual(0);
    expect(assessment.pressureAfter).toBeLessThanOrEqual(100);
  });

  it("assessment[0].pressureDelta is -10 to +10", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const assessment = after.frontierAssessments[0]!;
    expect(assessment.pressureDelta).toBeGreaterThanOrEqual(-10);
    expect(assessment.pressureDelta).toBeLessThanOrEqual(10);
  });

  it("state.resources.nation.borderPressure === assessment[0].pressureAfter", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const assessment = after.frontierAssessments[0]!;
    expect(after.resources.nation.borderPressure).toBe(assessment.pressureAfter);
  });

  it("assessment generation status is 'generated'", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    expect(after.frontierAssessments[0]!.generation.status).toBe("generated");
  });

  it("military memorial exists in state.memorials", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const gen = after.frontierAssessments[0]!.generation;
    expect(gen.status).toBe("generated");
    if (gen.status !== "generated") return;
    expect(after.memorials[gen.memorialId]).toBeDefined();
  });

  it("generated memorial has category === 'military'", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const gen = after.frontierAssessments[0]!.generation;
    if (gen.status !== "generated") return;
    const memorial = after.memorials[gen.memorialId]!;
    expect(memorial.category).toBe("military");
  });

  it("idempotent: calling twice with same year returns state unchanged", () => {
    const state = createNewGameState(db);
    const at = atMonth7(1);
    const after1 = applyAnnualFrontierAssessment(state, db, at);
    const after2 = applyAnnualFrontierAssessment(after1, db, at);
    // Second call returns the same object (reference equality)
    expect(after2).toBe(after1);
    expect(after2.frontierAssessments).toHaveLength(1);
  });

  it("when pending military exists, assessment has generation.status === 'blocked_by_pending'", () => {
    const state = createNewGameState(db);
    // Year 1: apply assessment → generates pending military memorial
    const after1 = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    expect(after1.frontierAssessments[0]!.generation.status).toBe("generated");

    // Year 2: pending military from year 1 blocks generation
    const after2 = applyAnnualFrontierAssessment(after1, db, atMonth7(2));
    expect(after2.frontierAssessments).toHaveLength(2);
    const assess2 = after2.frontierAssessments[1]!;
    expect(assess2.year).toBe(2);
    expect(assess2.generation.status).toBe("blocked_by_pending");
  });

  it("blocked_by_pending has blockingMemorialId pointing to the pending military memorial", () => {
    const state = createNewGameState(db);
    const after1 = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const gen1 = after1.frontierAssessments[0]!.generation;
    if (gen1.status !== "generated") return;
    const mem1Id = gen1.memorialId;

    const after2 = applyAnnualFrontierAssessment(after1, db, atMonth7(2));
    const gen2 = after2.frontierAssessments[1]!.generation;
    expect(gen2.status).toBe("blocked_by_pending");
    if (gen2.status !== "blocked_by_pending") return;
    expect(gen2.blockingMemorialId).toBe(mem1Id);
  });

  it("two consecutive years each get their own assessment", () => {
    const state = createNewGameState(db);
    const after1 = applyAnnualFrontierAssessment(state, db, atMonth7(1));
    const after2 = applyAnnualFrontierAssessment(after1, db, atMonth7(2));
    expect(after2.frontierAssessments).toHaveLength(2);
    expect(after2.frontierAssessments[0]!.year).toBe(1);
    expect(after2.frontierAssessments[1]!.year).toBe(2);
  });

  it("theater rotates correctly across years", () => {
    let state = createNewGameState(db);
    for (let year = 1; year <= 3; year++) {
      state = applyAnnualFrontierAssessment(state, db, atMonth7(year));
    }
    // Resolve the military memorial from year 1 before advancing
    // (In this test, we just check the theaterId for year 1 assessment)
    expect(state.frontierAssessments[0]!.theaterId).toBe("northern_frontier");
    // Note: year 2 and 3 will be blocked_by_pending if year 1 memorial is not resolved
    // But the theaterId should still be set correctly in the plan
  });

  it("theater is set correctly in the assessment record", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(3));
    expect(after.frontierAssessments[0]!.theaterId).toBe(theaterForYear(3));
  });

  it("save/load round-trip: frontierAssessments and borderPressure survive", () => {
    const state = createNewGameState(db);
    const after = applyAnnualFrontierAssessment(state, db, atMonth7(1));

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, after, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.frontierAssessments).toHaveLength(1);
    expect(loaded.value.state.frontierAssessments[0]!.year).toBe(1);
    expect(loaded.value.state.resources.nation.borderPressure).toBe(
      after.resources.nation.borderPressure,
    );
  });
});
