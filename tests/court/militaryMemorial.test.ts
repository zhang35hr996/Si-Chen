/**
 * Group E: generateMilitaryMemorial — options, costs, dedup, determinism.
 */
import { describe, expect, it } from "vitest";
import {
  generateMilitaryMemorial,
  MILITARY_OPTION_IDS,
} from "../../src/engine/court/memorials";
import {
  theaterForYear,
} from "../../src/engine/court/frontierAssessment";
import type { FrontierAssessmentPlan } from "../../src/engine/court/frontierAssessment";
import type { FrontierSeverity } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function atMonth7(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

/** Build a FrontierAssessmentPlan for testing. pressureAfter and military determine severity. */
function makePlan(
  year: number,
  severity: FrontierSeverity,
  overrides?: Partial<FrontierAssessmentPlan>,
): FrontierAssessmentPlan {
  // Choose pressureAfter/military that match the requested severity
  const severityParams: Record<FrontierSeverity, { pressureAfter: number; military: number }> = {
    stable:   { pressureAfter: 20, military: 50 },
    watch:    { pressureAfter: 45, military: 50 },
    urgent:   { pressureAfter: 65, military: 50 },
    critical: { pressureAfter: 85, military: 50 },
  };
  const { pressureAfter, military } = severityParams[severity];
  return {
    id: `frontier_assessment:${year}`,
    year,
    assessedAt: atMonth7(year),
    theaterId: theaterForYear(year),
    pressureBefore: 35,
    pressureDelta: pressureAfter - 35,
    pressureAfter,
    militaryAtAssessment: military,
    governanceAtAssessment: 50,
    publicSupportAtAssessment: 50,
    severity,
    rawDrift: pressureAfter - 35,
    militaryModifier: 0,
    governanceModifier: 0,
    publicSupportModifier: 0,
    ...overrides,
  };
}

// ── matter derivation ─────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — matter from severity", () => {
  it("stable severity → matter=annual_readiness", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "stable");
    const result = generateMilitaryMemorial(state, plan, atMonth7(1));
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.memorial.payload.category).toBe("military");
    if (result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.matter).toBe("annual_readiness");
  });

  it("watch severity → matter=border_fortification", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "watch");
    const result = generateMilitaryMemorial(state, plan, atMonth7(1));
    expect(result).not.toBeNull();
    if (!result) return;
    if (result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.matter).toBe("border_fortification");
  });

  it("urgent severity → matter=frontier_incursion", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "urgent");
    const result = generateMilitaryMemorial(state, plan, atMonth7(1));
    expect(result).not.toBeNull();
    if (!result) return;
    if (result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.matter).toBe("frontier_incursion");
  });

  it("critical severity → matter=frontier_incursion", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "critical");
    const result = generateMilitaryMemorial(state, plan, atMonth7(1));
    expect(result).not.toBeNull();
    if (!result) return;
    if (result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.matter).toBe("frontier_incursion");
  });
});

// ── urgency derivation ────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — urgency from severity", () => {
  it("stable → urgency=routine", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.urgency).toBe("routine");
  });

  it("watch → urgency=routine", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "watch"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.urgency).toBe("routine");
  });

  it("urgent → urgency=urgent", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "urgent"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.urgency).toBe("urgent");
  });

  it("critical → urgency=critical", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "critical"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    expect(result.memorial.payload.urgency).toBe("critical");
  });
});

// ── sourceId format ───────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — sourceId", () => {
  it("sourceId follows pattern military:{matter}:{theaterId}:{year}", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "stable"); // → annual_readiness, northern_frontier, year=1
    const result = generateMilitaryMemorial(state, plan, atMonth7(1));
    expect(result?.memorial.sourceId).toBe(`military:annual_readiness:northern_frontier:1`);
  });

  it("sourceId for border_fortification year=2 (western_frontier)", () => {
    const state = createNewGameState(db);
    const plan = makePlan(2, "watch"); // → border_fortification, western_frontier, year=2
    const result = generateMilitaryMemorial(state, plan, atMonth7(2));
    expect(result?.memorial.sourceId).toBe(`military:border_fortification:western_frontier:2`);
  });
});

// ── dedup ─────────────────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — dedup", () => {
  it("returns null if sourceId already exists as pending", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "stable");
    const r1 = generateMilitaryMemorial(state, plan, atMonth7(1))!;
    expect(r1).not.toBeNull();
    const r2 = generateMilitaryMemorial(r1.state, plan, atMonth7(1));
    expect(r2).toBeNull();
  });

  it("returns null if sourceId already resolved", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "stable");
    const r1 = generateMilitaryMemorial(state, plan, atMonth7(1))!;
    // Manually mark it as resolved
    const resolvedState = {
      ...r1.state,
      memorials: {
        ...r1.state.memorials,
        [r1.memorial.id]: { ...r1.memorial, status: "resolved" as const, resolvedAt: atMonth7(1), resolution: "drill" },
      },
    };
    const r2 = generateMilitaryMemorial(resolvedState, plan, atMonth7(1));
    expect(r2).toBeNull();
  });

  it("returns null if a pending military memorial exists (different sourceId)", () => {
    const state = createNewGameState(db);
    // Generate year 1 memorial (pending)
    const r1 = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1))!;
    expect(r1).not.toBeNull();
    // Try to generate year 2 memorial — blocked by existing pending military
    const r2 = generateMilitaryMemorial(r1.state, makePlan(2, "watch"), atMonth7(2));
    expect(r2).toBeNull();
  });
});

// ── memorial ID ───────────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — ID sequencing", () => {
  it("memorial ID uses max-seq+1 pattern (first = mem_000001)", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    expect(result?.memorial.id).toBe("mem_000001");
  });
});

// ── options ───────────────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — option sets", () => {
  it("annual_readiness has exactly [drill, repair_armories, defer_readiness]", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    expect(result).not.toBeNull();
    if (!result || result.memorial.payload.category !== "military") return;
    const ids = result.memorial.payload.options.map((o) => o.id).sort();
    expect(ids).toEqual([...MILITARY_OPTION_IDS.annual_readiness].sort());
  });

  it("border_fortification has exactly [fortify_passes, rotate_garrison, local_levy]", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "watch"), atMonth7(1));
    expect(result).not.toBeNull();
    if (!result || result.memorial.payload.category !== "military") return;
    const ids = result.memorial.payload.options.map((o) => o.id).sort();
    expect(ids).toEqual([...MILITARY_OPTION_IDS.border_fortification].sort());
  });

  it("frontier_incursion has exactly [mobilize, hold_line, negotiate]", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "urgent"), atMonth7(1));
    expect(result).not.toBeNull();
    if (!result || result.memorial.payload.category !== "military") return;
    const ids = result.memorial.payload.options.map((o) => o.id).sort();
    expect(ids).toEqual([...MILITARY_OPTION_IDS.frontier_incursion].sort());
  });
});

// ── treasury costs ────────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — treasury costs", () => {
  it("drill → treasuryDelta = -600", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const drill = result.memorial.payload.options.find((o) => o.id === "drill")!;
    expect(drill.treasuryDelta).toBe(-600);
  });

  it("repair_armories → treasuryDelta = -800", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "repair_armories")!;
    expect(opt.treasuryDelta).toBe(-800);
  });

  it("defer_readiness → treasuryDelta undefined (no cost)", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "defer_readiness")!;
    expect(opt.treasuryDelta).toBeUndefined();
  });

  it("fortify_passes → treasuryDelta = -1200", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "watch"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "fortify_passes")!;
    expect(opt.treasuryDelta).toBe(-1200);
  });

  it("rotate_garrison → treasuryDelta = -700", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "watch"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "rotate_garrison")!;
    expect(opt.treasuryDelta).toBe(-700);
  });

  it("local_levy → treasuryDelta undefined (no cost)", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "watch"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "local_levy")!;
    expect(opt.treasuryDelta).toBeUndefined();
  });

  it("urgent mobilize → treasuryDelta = -1800", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "urgent"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "mobilize")!;
    expect(opt.treasuryDelta).toBe(-1800);
  });

  it("critical mobilize → treasuryDelta = -2800", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "critical"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "mobilize")!;
    expect(opt.treasuryDelta).toBe(-2800);
  });
});

// ── effects ───────────────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — effects", () => {
  it("drill has nation.military +5 and nation.borderPressure -2", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "stable"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const drill = result.memorial.payload.options.find((o) => o.id === "drill")!;
    const militaryEffect = drill.effects.find((e) => e.field === "military");
    const pressureEffect = drill.effects.find((e) => e.field === "borderPressure");
    expect(militaryEffect?.delta).toBe(5);
    expect(pressureEffect?.delta).toBe(-2);
  });

  it("fortify_passes has nation.borderPressure -7 and nation.military +2", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "watch"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "fortify_passes")!;
    const pressureEffect = opt.effects.find((e) => e.field === "borderPressure");
    const militaryEffect = opt.effects.find((e) => e.field === "military");
    expect(pressureEffect?.delta).toBe(-7);
    expect(militaryEffect?.delta).toBe(2);
  });

  it("urgent mobilize has sovereign.fatigue +2", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "urgent"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "mobilize")!;
    const fatigueEffect = opt.effects.find((e) => e.pillar === "sovereign" && e.field === "fatigue");
    expect(fatigueEffect?.delta).toBe(2);
  });

  it("critical mobilize has sovereign.fatigue +3 and nation.borderPressure -10", () => {
    const state = createNewGameState(db);
    const result = generateMilitaryMemorial(state, makePlan(1, "critical"), atMonth7(1));
    if (!result || result.memorial.payload.category !== "military") return;
    const opt = result.memorial.payload.options.find((o) => o.id === "mobilize")!;
    const fatigueEffect = opt.effects.find((e) => e.pillar === "sovereign" && e.field === "fatigue");
    const pressureEffect = opt.effects.find((e) => e.field === "borderPressure");
    expect(fatigueEffect?.delta).toBe(3);
    expect(pressureEffect?.delta).toBe(-10);
  });
});

// ── determinism ───────────────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — determinism", () => {
  it("same inputs → same memorial ID and options", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "stable");
    const r1 = generateMilitaryMemorial(state, plan, atMonth7(1));
    const r2 = generateMilitaryMemorial(state, plan, atMonth7(1));
    expect(JSON.stringify(r1?.memorial)).toBe(JSON.stringify(r2?.memorial));
  });
});

// ── year mismatch guard ───────────────────────────────────────────────────────

describe("Group E: generateMilitaryMemorial — year consistency", () => {
  it("returns null if at.year !== assessment.year", () => {
    const state = createNewGameState(db);
    const plan = makePlan(1, "stable");
    // at.year=2 but plan.year=1 → mismatch
    const result = generateMilitaryMemorial(state, plan, atMonth7(2));
    expect(result).toBeNull();
  });
});
