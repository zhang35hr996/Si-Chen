/**
 * Group C: classifyFrontierSeverity and theaterForYear.
 */
import { describe, expect, it } from "vitest";
import { classifyFrontierSeverity, theaterForYear } from "../../src/engine/court/frontierAssessment";

// ── classifyFrontierSeverity ──────────────────────────────────────────────────

describe("Group C: classifyFrontierSeverity", () => {
  // critical by pressure (>=80)
  it("pressureAfter=85, military=50 → critical (by pressure)", () => {
    expect(classifyFrontierSeverity(85, 50)).toBe("critical");
  });

  it("pressureAfter=80, military=50 → critical (boundary: exactly 80)", () => {
    expect(classifyFrontierSeverity(80, 50)).toBe("critical");
  });

  // critical by military (<=25)
  it("pressureAfter=50, military=20 → critical (by military ≤25)", () => {
    expect(classifyFrontierSeverity(50, 20)).toBe("critical");
  });

  it("pressureAfter=50, military=25 → critical (boundary: military=25)", () => {
    expect(classifyFrontierSeverity(50, 25)).toBe("critical");
  });

  // urgent by pressure (>=60)
  it("pressureAfter=70, military=50 → urgent (by pressure)", () => {
    expect(classifyFrontierSeverity(70, 50)).toBe("urgent");
  });

  it("pressureAfter=60, military=50 → urgent (boundary: exactly 60)", () => {
    expect(classifyFrontierSeverity(60, 50)).toBe("urgent");
  });

  // urgent by military (<=40)
  it("pressureAfter=50, military=35 → urgent (by military ≤40)", () => {
    expect(classifyFrontierSeverity(50, 35)).toBe("urgent");
  });

  it("pressureAfter=50, military=40 → urgent (boundary: military=40)", () => {
    expect(classifyFrontierSeverity(50, 40)).toBe("urgent");
  });

  // watch (pressure>=40, not >=60, not critical)
  it("pressureAfter=45, military=50 → watch", () => {
    expect(classifyFrontierSeverity(45, 50)).toBe("watch");
  });

  it("pressureAfter=40, military=50 → watch (boundary: exactly 40)", () => {
    expect(classifyFrontierSeverity(40, 50)).toBe("watch");
  });

  // stable (pressure<40, not critical/urgent)
  it("pressureAfter=20, military=50 → stable", () => {
    expect(classifyFrontierSeverity(20, 50)).toBe("stable");
  });

  it("pressureAfter=0, military=50 → stable", () => {
    expect(classifyFrontierSeverity(0, 50)).toBe("stable");
  });

  it("pressureAfter=39, military=50 → stable (just below watch threshold)", () => {
    expect(classifyFrontierSeverity(39, 50)).toBe("stable");
  });

  // Priority: critical > urgent > watch
  it("both critical conditions: pressureAfter=80, military=20 → critical", () => {
    expect(classifyFrontierSeverity(80, 20)).toBe("critical");
  });

  it("critical by pressure beats urgent by military: pressureAfter=80, military=35 → critical", () => {
    expect(classifyFrontierSeverity(80, 35)).toBe("critical");
  });

  // Edge cases: boundaries between stable and watch
  it("military=26 (just above critical threshold) with low pressure → not critical", () => {
    expect(classifyFrontierSeverity(20, 26)).not.toBe("critical");
  });

  it("military=41 (just above urgent threshold) with moderate pressure → not urgent by military alone", () => {
    // pressure=50 < 60, military=41 > 40 → stable (pressure=50 < 40? No → watch)
    // Actually pressureAfter=50 ≥ 40 → watch
    expect(classifyFrontierSeverity(50, 41)).toBe("watch");
  });
});

// ── theaterForYear ─────────────────────────────────────────────────────────────

describe("Group C: theaterForYear rotation", () => {
  it("year=1 → northern_frontier", () => {
    expect(theaterForYear(1)).toBe("northern_frontier");
  });

  it("year=2 → western_frontier", () => {
    expect(theaterForYear(2)).toBe("western_frontier");
  });

  it("year=3 → southern_frontier", () => {
    expect(theaterForYear(3)).toBe("southern_frontier");
  });

  it("year=4 → northern_frontier (cycle repeats)", () => {
    expect(theaterForYear(4)).toBe("northern_frontier");
  });

  it("year=5 → western_frontier", () => {
    expect(theaterForYear(5)).toBe("western_frontier");
  });

  it("year=6 → southern_frontier", () => {
    expect(theaterForYear(6)).toBe("southern_frontier");
  });

  it("year=7 → northern_frontier (7-1=6, 6%3=0 → index 0)", () => {
    expect(theaterForYear(7)).toBe("northern_frontier");
  });

  it("rotation is deterministic and consistent", () => {
    // Verify the 3-cycle pattern over 9 years
    const expected = ["northern_frontier", "western_frontier", "southern_frontier"];
    for (let year = 1; year <= 9; year++) {
      expect(theaterForYear(year)).toBe(expected[(year - 1) % 3]);
    }
  });
});
