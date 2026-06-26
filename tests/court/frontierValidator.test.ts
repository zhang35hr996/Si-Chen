/**
 * Group I: validateFrontierAssessments with corrupted states.
 */
import { describe, expect, it } from "vitest";
import { validateFrontierAssessments, theaterForYear } from "../../src/engine/court/frontierAssessment";
import type { FrontierAssessment } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function atYear(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

/** Build a valid FrontierAssessment for the given year. */
function makeValidAssessment(year: number): FrontierAssessment {
  return {
    id: `frontier_assessment:${year}`,
    year,
    assessedAt: atYear(year),
    theaterId: theaterForYear(year),
    pressureBefore: 35,
    pressureDelta: 5,
    pressureAfter: 40, // 35 + 5 = 40 (within [0, 100])
    militaryAtAssessment: 50,
    governanceAtAssessment: 50,
    publicSupportAtAssessment: 50,
    severity: "watch", // classifyFrontierSeverity(40, 50) = "watch"
    generation: { status: "generated", memorialId: "mem_000001" },
  };
}

/** State with a minimal valid memorial entry. */
function stateWith(assessments: FrontierAssessment[], memorialId = "mem_000001") {
  const base = createNewGameState(db);
  const mem = {
    id: memorialId,
    category: "military" as const,
    status: "pending" as const,
    createdAt: atYear(1),
    sourceId: `military:annual_readiness:northern_frontier:1`,
    title: "Test",
    summary: "Test",
    payload: {
      category: "military" as const,
      matter: "border_fortification" as const,
      urgency: "routine" as const,
      theaterId: "northern_frontier" as const,
      pressureAtCreation: 40,
      militaryAtCreation: 50,
      options: [
        {
          id: "fortify_passes", label: "增修关隘",
          effects: [{ type: "resource" as const, pillar: "nation" as const, field: "borderPressure", delta: -7 }],
          treasuryDelta: -1200 as const,
        },
        {
          id: "rotate_garrison", label: "轮戍边军",
          effects: [{ type: "resource" as const, pillar: "nation" as const, field: "military", delta: 5 }],
          treasuryDelta: -700 as const,
        },
        {
          id: "local_levy", label: "就地募兵",
          effects: [{ type: "resource" as const, pillar: "nation" as const, field: "military", delta: 4 }],
        },
      ],
    },
  };
  return {
    ...base,
    frontierAssessments: assessments,
    memorials: { [memorialId]: mem },
  };
}

// ── Valid state ────────────────────────────────────────────────────────────────

describe("Group I: validateFrontierAssessments — valid state", () => {
  it("valid single assessment passes validation", () => {
    const state = stateWith([makeValidAssessment(1)]);
    expect(validateFrontierAssessments(state)).toEqual([]);
  });

  it("valid two assessments pass validation", () => {
    const a1 = makeValidAssessment(1);
    const a2 = makeValidAssessment(2);
    const state = stateWith([a1, a2], "mem_000001");
    // Add second memorial for a2 — createdAt must be at or after a2's assessedAt (year 2)
    const state2 = {
      ...state,
      frontierAssessments: [a1, a2],
      memorials: {
        ...state.memorials,
        "mem_000002": {
          ...state.memorials["mem_000001"]!,
          id: "mem_000002",
          sourceId: "military:border_fortification:western_frontier:2",
          createdAt: atYear(2), // must not be before a2.assessedAt
        },
      },
    };
    // Update a2's generation to point to mem_000002
    state2.frontierAssessments = [
      a1,
      { ...a2, generation: { status: "generated" as const, memorialId: "mem_000002" } },
    ];
    expect(validateFrontierAssessments(state2)).toEqual([]);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("Group I: validateFrontierAssessments — error codes", () => {
  it("FRONTIER_DUPLICATE_YEAR: two assessments with same year", () => {
    const a1 = makeValidAssessment(1);
    const a2 = makeValidAssessment(1); // duplicate year
    const state = {
      ...stateWith([a1]),
      frontierAssessments: [a1, a2],
      memorials: {
        "mem_000001": stateWith([a1]).memorials["mem_000001"]!,
      },
    };
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_DUPLICATE_YEAR")).toBe(true);
  });

  it("FRONTIER_INVALID_ID: id does not match frontier_assessment:{year}", () => {
    const a = { ...makeValidAssessment(1), id: "frontier_assessment:999" }; // wrong year in ID
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_INVALID_ID")).toBe(true);
  });

  it("FRONTIER_INVALID_YEAR: year=0 is not valid", () => {
    const a = { ...makeValidAssessment(1), year: 0, id: "frontier_assessment:0" };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_INVALID_YEAR")).toBe(true);
  });

  it("FRONTIER_NOT_SORTED: later year before earlier year", () => {
    const a1 = makeValidAssessment(3);
    const a2 = makeValidAssessment(1);
    // Provide memorials for both
    const state = {
      ...stateWith([a1, a2]),
      frontierAssessments: [a1, a2],
      memorials: {
        "mem_000001": stateWith([a1]).memorials["mem_000001"]!,
      },
    };
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_NOT_SORTED")).toBe(true);
  });

  it("FRONTIER_ASSESSED_AT_MISMATCH: assessedAt.year !== year", () => {
    const a = {
      ...makeValidAssessment(1),
      assessedAt: { ...atYear(1), year: 2 }, // assessedAt.year=2, but assessment.year=1
    };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_ASSESSED_AT_MISMATCH")).toBe(true);
  });

  it("FRONTIER_INVALID_THEATER: invalid theaterId", () => {
    const a = { ...makeValidAssessment(1), theaterId: "eastern_frontier" as any };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_INVALID_THEATER")).toBe(true);
  });

  it("FRONTIER_BAD_PRESSURE: pressureBefore < 0", () => {
    const a = { ...makeValidAssessment(1), pressureBefore: -1 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_PRESSURE")).toBe(true);
  });

  it("FRONTIER_BAD_PRESSURE: pressureBefore > 100", () => {
    const a = { ...makeValidAssessment(1), pressureBefore: 101 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_PRESSURE")).toBe(true);
  });

  it("FRONTIER_BAD_PRESSURE: pressureAfter < 0", () => {
    const a = { ...makeValidAssessment(1), pressureAfter: -1 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_PRESSURE")).toBe(true);
  });

  it("FRONTIER_BAD_PRESSURE: pressureAfter > 100", () => {
    const a = { ...makeValidAssessment(1), pressureAfter: 101 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_PRESSURE")).toBe(true);
  });

  it("FRONTIER_BAD_DELTA: pressureDelta < -10", () => {
    const a = { ...makeValidAssessment(1), pressureDelta: -11, pressureAfter: 24 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_DELTA")).toBe(true);
  });

  it("FRONTIER_BAD_DELTA: pressureDelta > 10", () => {
    const a = { ...makeValidAssessment(1), pressureDelta: 11, pressureAfter: 46 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_DELTA")).toBe(true);
  });

  it("FRONTIER_BAD_EQUATION: pressureAfter !== clamp(pressureBefore+pressureDelta)", () => {
    // pressureBefore=35, pressureDelta=5, pressureAfter should be 40, but we set 41
    const a = { ...makeValidAssessment(1), pressureAfter: 41 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_EQUATION")).toBe(true);
  });

  it("FRONTIER_BAD_SNAPSHOT: militaryAtAssessment < 0", () => {
    const a = { ...makeValidAssessment(1), militaryAtAssessment: -1 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_SNAPSHOT")).toBe(true);
  });

  it("FRONTIER_BAD_SNAPSHOT: governanceAtAssessment > 100", () => {
    const a = { ...makeValidAssessment(1), governanceAtAssessment: 101 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_SNAPSHOT")).toBe(true);
  });

  it("FRONTIER_BAD_SNAPSHOT: publicSupportAtAssessment out of range", () => {
    const a = { ...makeValidAssessment(1), publicSupportAtAssessment: -5 };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_SNAPSHOT")).toBe(true);
  });

  it("FRONTIER_BAD_SEVERITY: invalid severity value", () => {
    const a = { ...makeValidAssessment(1), severity: "dire" as any };
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_SEVERITY")).toBe(true);
  });

  it("FRONTIER_BAD_SEVERITY: severity inconsistent with snapshots (pressureAfter=40/military=50 should be watch, not stable)", () => {
    const a = { ...makeValidAssessment(1), severity: "stable" as any }; // should be "watch"
    const state = stateWith([a]);
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_BAD_SEVERITY")).toBe(true);
  });

  it("FRONTIER_MISSING_MEMORIAL: generation='generated' but memorialId not in memorials", () => {
    const a: FrontierAssessment = {
      ...makeValidAssessment(1),
      generation: { status: "generated", memorialId: "mem_999999" }, // doesn't exist
    };
    const base = createNewGameState(db);
    const state = { ...base, frontierAssessments: [a], memorials: {} };
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_MISSING_MEMORIAL")).toBe(true);
  });

  it("FRONTIER_MEMORIAL_WRONG_CATEGORY: memorial exists but is not military category", () => {
    const base = createNewGameState(db);
    const a = makeValidAssessment(1);
    const nonMilitaryMem = {
      id: "mem_000001",
      category: "disaster" as const,
      status: "pending" as const,
      createdAt: atYear(1),
      sourceId: "disaster:jiangnan:1",
      title: "T",
      summary: "S",
      payload: {
        category: "disaster" as const,
        regionId: "jiangnan",
        severity: "minor" as const,
        options: [{ id: "ignore", label: "忽视", effects: [] }],
      },
    };
    const state = {
      ...base,
      frontierAssessments: [a],
      memorials: { "mem_000001": nonMilitaryMem },
    };
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_MEMORIAL_WRONG_CATEGORY")).toBe(true);
  });

  it("FRONTIER_MISSING_BLOCKING: blocked_by_pending with missing blockingMemorialId", () => {
    const a: FrontierAssessment = {
      ...makeValidAssessment(1),
      generation: { status: "blocked_by_pending", blockingMemorialId: "mem_999999" },
    };
    const base = createNewGameState(db);
    const state = { ...base, frontierAssessments: [a], memorials: {} };
    const errors = validateFrontierAssessments(state);
    expect(errors.some((e) => e.code === "FRONTIER_MISSING_BLOCKING")).toBe(true);
  });
});
