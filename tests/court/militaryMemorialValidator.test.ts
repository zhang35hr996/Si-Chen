/**
 * Group J: validateMemorials — military-specific validation.
 */
import { describe, expect, it } from "vitest";
import { validateMemorials } from "../../src/engine/court/memorials";
import type { Memorial } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function atYear(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

const VALID_EFFECTS_WATCH = [
  { type: "resource" as const, pillar: "nation" as const, field: "borderPressure", delta: -7 },
  { type: "resource" as const, pillar: "nation" as const, field: "military", delta: 2 },
  { type: "resource" as const, pillar: "nation" as const, field: "productivity", delta: -2 },
];

const VALID_EFFECTS_STABLE = [
  { type: "resource" as const, pillar: "nation" as const, field: "military", delta: 5 },
  { type: "resource" as const, pillar: "nation" as const, field: "borderPressure", delta: -2 },
  { type: "resource" as const, pillar: "nation" as const, field: "productivity", delta: -1 },
];

/** Build a valid military memorial. */
function makeValidMilitary(overrides?: Partial<Memorial>): Memorial {
  return {
    id: "mem_000001",
    category: "military",
    status: "pending",
    createdAt: atYear(1),
    sourceId: "military:border_fortification:northern_frontier:1",
    title: "边备整饬",
    summary: "请旨裁示。",
    payload: {
      category: "military",
      matter: "border_fortification",
      urgency: "routine",
      theaterId: "northern_frontier",
      pressureAtCreation: 45,
      militaryAtCreation: 50,
      options: [
        { id: "fortify_passes", label: "增修关隘", effects: VALID_EFFECTS_WATCH, treasuryDelta: -1200 },
        { id: "rotate_garrison", label: "轮戍边军", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "military", delta: 5 }], treasuryDelta: -700 },
        { id: "local_levy", label: "就地募兵", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "military", delta: 4 }] },
      ],
    },
    ...overrides,
  };
}

function stateWithMem(m: Memorial) {
  const base = createNewGameState(db);
  return { ...base, memorials: { [m.id]: m } };
}

// ── Valid memorial ─────────────────────────────────────────────────────────────

describe("Group J: validateMemorials — valid military memorial", () => {
  it("valid military memorial passes validation", () => {
    const m = makeValidMilitary();
    expect(validateMemorials(stateWithMem(m))).toEqual([]);
  });

  it("frontier_incursion urgent passes validation", () => {
    const m = makeValidMilitary({
      sourceId: "military:frontier_incursion:northern_frontier:1",
      payload: {
        category: "military",
        matter: "frontier_incursion",
        urgency: "urgent",
        theaterId: "northern_frontier",
        pressureAtCreation: 65,
        militaryAtCreation: 50,
        options: [
          { id: "mobilize", label: "调兵出征", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "military", delta: 6 }], treasuryDelta: -1800 },
          { id: "hold_line", label: "坚守待援", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "military", delta: 3 }], treasuryDelta: -1200 },
          { id: "negotiate", label: "遣使议和", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "borderPressure", delta: -4 }], treasuryDelta: -600 },
        ],
      },
    });
    expect(validateMemorials(stateWithMem(m))).toEqual([]);
  });
});

// ── Category mismatch ─────────────────────────────────────────────────────────

describe("Group J: validateMemorials — category mismatch", () => {
  it("MEMORIAL_CATEGORY_MISMATCH: outer category=disaster but payload.category=military", () => {
    const m = makeValidMilitary({ category: "disaster" });
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_CATEGORY_MISMATCH")).toBe(true);
  });
});

// ── Bad matter ─────────────────────────────────────────────────────────────────

describe("Group J: validateMemorials — invalid matter", () => {
  it("MEMORIAL_BAD_MATTER: invalid matter value", () => {
    const m = makeValidMilitary();
    const mWithBadMatter = {
      ...m,
      payload: { ...m.payload as any, matter: "garrison_raid" },
    };
    const errors = validateMemorials(stateWithMem(mWithBadMatter));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_MATTER")).toBe(true);
  });
});

// ── Bad urgency ───────────────────────────────────────────────────────────────

describe("Group J: validateMemorials — invalid urgency", () => {
  it("MEMORIAL_BAD_URGENCY: invalid urgency value", () => {
    const m = makeValidMilitary();
    const mWithBadUrgency = {
      ...m,
      payload: { ...m.payload as any, urgency: "panic" },
    };
    const errors = validateMemorials(stateWithMem(mWithBadUrgency));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_URGENCY")).toBe(true);
  });
});

// ── Matter-urgency constraints ─────────────────────────────────────────────────

describe("Group J: validateMemorials — matter↔urgency constraints", () => {
  it("MEMORIAL_MATTER_URGENCY_MISMATCH: annual_readiness with urgency=urgent", () => {
    const m = makeValidMilitary({
      payload: {
        category: "military",
        matter: "annual_readiness",
        urgency: "urgent", // should be routine
        theaterId: "northern_frontier",
        pressureAtCreation: 20,
        militaryAtCreation: 50,
        options: [
          { id: "drill", label: "操练", effects: VALID_EFFECTS_STABLE, treasuryDelta: -600 },
          { id: "repair_armories", label: "修库", effects: VALID_EFFECTS_STABLE, treasuryDelta: -800 },
          { id: "defer_readiness", label: "暂缓", effects: VALID_EFFECTS_STABLE },
        ],
      },
    });
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_MATTER_URGENCY_MISMATCH")).toBe(true);
  });

  it("MEMORIAL_MATTER_URGENCY_MISMATCH: border_fortification with urgency=critical", () => {
    const m = makeValidMilitary({
      payload: {
        category: "military",
        matter: "border_fortification",
        urgency: "critical", // should be routine
        theaterId: "northern_frontier",
        pressureAtCreation: 45,
        militaryAtCreation: 50,
        options: [
          { id: "fortify_passes", label: "增修", effects: VALID_EFFECTS_WATCH, treasuryDelta: -1200 },
          { id: "rotate_garrison", label: "轮戍", effects: VALID_EFFECTS_WATCH, treasuryDelta: -700 },
          { id: "local_levy", label: "募兵", effects: VALID_EFFECTS_WATCH },
        ],
      },
    });
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_MATTER_URGENCY_MISMATCH")).toBe(true);
  });

  it("MEMORIAL_MATTER_URGENCY_MISMATCH: frontier_incursion with urgency=routine", () => {
    const m = makeValidMilitary({
      sourceId: "military:frontier_incursion:northern_frontier:1",
      payload: {
        category: "military",
        matter: "frontier_incursion",
        urgency: "routine", // should be urgent or critical
        theaterId: "northern_frontier",
        pressureAtCreation: 65,
        militaryAtCreation: 50,
        options: [
          { id: "mobilize", label: "出征", effects: VALID_EFFECTS_WATCH, treasuryDelta: -1800 },
          { id: "hold_line", label: "坚守", effects: VALID_EFFECTS_WATCH, treasuryDelta: -1200 },
          { id: "negotiate", label: "议和", effects: VALID_EFFECTS_WATCH, treasuryDelta: -600 },
        ],
      },
    });
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_MATTER_URGENCY_MISMATCH")).toBe(true);
  });
});

// ── Bad theaterId ─────────────────────────────────────────────────────────────

describe("Group J: validateMemorials — bad theaterId", () => {
  it("MEMORIAL_BAD_THEATER: invalid theaterId", () => {
    const m = makeValidMilitary();
    const mBad = {
      ...m,
      payload: { ...m.payload as any, theaterId: "eastern_frontier" },
    };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_THEATER")).toBe(true);
  });
});

// ── Snapshot range ────────────────────────────────────────────────────────────

describe("Group J: validateMemorials — snapshot range", () => {
  it("MEMORIAL_BAD_SNAPSHOT: pressureAtCreation < 0", () => {
    const m = makeValidMilitary();
    const mBad = { ...m, payload: { ...m.payload as any, pressureAtCreation: -1 } };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_SNAPSHOT")).toBe(true);
  });

  it("MEMORIAL_BAD_SNAPSHOT: militaryAtCreation > 100", () => {
    const m = makeValidMilitary();
    const mBad = { ...m, payload: { ...m.payload as any, militaryAtCreation: 101 } };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_SNAPSHOT")).toBe(true);
  });
});

// ── Options validation ─────────────────────────────────────────────────────────

describe("Group J: validateMemorials — options", () => {
  it("MEMORIAL_NO_OPTIONS: options list empty", () => {
    const m = makeValidMilitary();
    const mBad = { ...m, payload: { ...m.payload as any, options: [] } };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_NO_OPTIONS")).toBe(true);
  });

  it("MEMORIAL_DUP_OPTION: duplicate option ID", () => {
    const m = makeValidMilitary();
    const p = m.payload as any;
    const mBad = {
      ...m,
      payload: {
        ...p,
        options: [
          { id: "fortify_passes", label: "A", effects: VALID_EFFECTS_WATCH, treasuryDelta: -1200 },
          { id: "fortify_passes", label: "B", effects: VALID_EFFECTS_WATCH, treasuryDelta: -700 }, // duplicate
          { id: "local_levy", label: "C", effects: VALID_EFFECTS_WATCH },
        ],
      },
    };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_DUP_OPTION")).toBe(true);
  });

  it("MEMORIAL_MISSING_OPTION: annual_readiness missing 'drill'", () => {
    const m = makeValidMilitary({
      sourceId: "military:annual_readiness:northern_frontier:1",
      payload: {
        category: "military",
        matter: "annual_readiness",
        urgency: "routine",
        theaterId: "northern_frontier",
        pressureAtCreation: 20,
        militaryAtCreation: 50,
        options: [
          // missing "drill"
          { id: "repair_armories", label: "修库", effects: VALID_EFFECTS_STABLE, treasuryDelta: -800 },
          { id: "defer_readiness", label: "暂缓", effects: VALID_EFFECTS_STABLE },
        ],
      },
    });
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_MISSING_OPTION")).toBe(true);
  });

  it("MEMORIAL_EXTRA_OPTION: border_fortification with wrong/extra option", () => {
    const m = makeValidMilitary({
      payload: {
        category: "military",
        matter: "border_fortification",
        urgency: "routine",
        theaterId: "northern_frontier",
        pressureAtCreation: 45,
        militaryAtCreation: 50,
        options: [
          { id: "fortify_passes", label: "增修", effects: VALID_EFFECTS_WATCH, treasuryDelta: -1200 },
          { id: "rotate_garrison", label: "轮戍", effects: VALID_EFFECTS_WATCH, treasuryDelta: -700 },
          { id: "local_levy", label: "募兵", effects: VALID_EFFECTS_WATCH },
          { id: "extra_option", label: "多余", effects: VALID_EFFECTS_WATCH }, // extra
        ],
      },
    });
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_EXTRA_OPTION")).toBe(true);
  });

  it("MEMORIAL_BAD_TREASURY_DELTA: treasuryDelta === 0 is invalid", () => {
    const m = makeValidMilitary();
    const p = m.payload as any;
    const mBad = {
      ...m,
      payload: {
        ...p,
        options: [
          { id: "fortify_passes", label: "增修", effects: VALID_EFFECTS_WATCH, treasuryDelta: 0 }, // invalid
          { id: "rotate_garrison", label: "轮戍", effects: VALID_EFFECTS_WATCH, treasuryDelta: -700 },
          { id: "local_levy", label: "募兵", effects: VALID_EFFECTS_WATCH },
        ],
      },
    };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_TREASURY_DELTA")).toBe(true);
  });
});

// ── Resolution validation ─────────────────────────────────────────────────────

describe("Group J: validateMemorials — resolution validation", () => {
  it("MEMORIAL_BAD_RESOLUTION: resolved with non-existent option ID", () => {
    const m: Memorial = {
      ...makeValidMilitary(),
      status: "resolved",
      resolvedAt: atYear(1),
      resolution: "nonexistent_option",
    };
    const errors = validateMemorials(stateWithMem(m));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_RESOLUTION")).toBe(true);
  });
});

// ── Effect validation via eventEffectSchema (P2b fix) ─────────────────────────

describe("Group J: validateMemorials — effect schema validation", () => {
  it("MEMORIAL_BAD_EFFECT: effect with delta > 10 is rejected", () => {
    const m = makeValidMilitary();
    const p = m.payload as any;
    const mBad = {
      ...m,
      payload: {
        ...p,
        options: [
          {
            id: "fortify_passes", label: "增修",
            // delta=11 exceeds AXIS_CAP=10, eventEffectSchema rejects it
            effects: [{ type: "resource", pillar: "nation", field: "borderPressure", delta: -11 }],
            treasuryDelta: -1200,
          },
          { id: "rotate_garrison", label: "轮戍", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 5 }], treasuryDelta: -700 },
          { id: "local_levy", label: "募兵", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 4 }] },
        ],
      },
    };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_EFFECT")).toBe(true);
  });

  it("MEMORIAL_BAD_EFFECT: effect with treasury field is rejected", () => {
    const m = makeValidMilitary();
    const p = m.payload as any;
    const mBad = {
      ...m,
      payload: {
        ...p,
        options: [
          {
            id: "fortify_passes", label: "增修",
            // "treasury" field is not allowed in eventEffectSchema resource effects
            effects: [{ type: "resource", pillar: "nation", field: "treasury", delta: -5 }],
            treasuryDelta: -1200,
          },
          { id: "rotate_garrison", label: "轮戍", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 5 }], treasuryDelta: -700 },
          { id: "local_levy", label: "募兵", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 4 }] },
        ],
      },
    };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_EFFECT")).toBe(true);
  });

  it("MEMORIAL_BAD_EFFECT: effect with invalid type is rejected", () => {
    const m = makeValidMilitary();
    const p = m.payload as any;
    const mBad = {
      ...m,
      payload: {
        ...p,
        options: [
          {
            id: "fortify_passes", label: "增修",
            effects: [{ type: "mood", pillar: "nation", field: "military", delta: 3 }], // invalid type
            treasuryDelta: -1200,
          },
          { id: "rotate_garrison", label: "轮戍", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 5 }], treasuryDelta: -700 },
          { id: "local_levy", label: "募兵", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 4 }] },
        ],
      },
    };
    const errors = validateMemorials(stateWithMem(mBad));
    expect(errors.some((e) => e.code === "MEMORIAL_BAD_EFFECT")).toBe(true);
  });
});
