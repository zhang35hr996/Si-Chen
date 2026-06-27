/**
 * Group K: memorialCard for military payloads — contextLabel, FIELD_LABEL, formatBorderPressure,
 * theater names, treasury costs, disabled state, raw field names.
 */
import { describe, expect, it } from "vitest";
import { memorialCard } from "../../src/ui/court/memorialsView";
import type { Memorial } from "../../src/engine/state/types";
import { dayIndexOf } from "../../src/engine/calendar/time";

function atYear(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

/** Build a minimal valid military memorial. */
function makeMilitaryMemorial(overrides?: Partial<{
  matter: "annual_readiness" | "border_fortification" | "frontier_incursion";
  urgency: "routine" | "urgent" | "critical";
  theaterId: "northern_frontier" | "western_frontier" | "southern_frontier";
  pressureAtCreation: number;
  militaryAtCreation: number;
}>): Memorial {
  const matter = overrides?.matter ?? "border_fortification";
  const urgency = overrides?.urgency ?? "routine";
  const theaterId = overrides?.theaterId ?? "northern_frontier";
  const pressureAtCreation = overrides?.pressureAtCreation ?? 45;
  const militaryAtCreation = overrides?.militaryAtCreation ?? 50;

  const optionsByMatter: Record<string, { id: string; label: string; effects: any[]; treasuryDelta?: number }[]> = {
    annual_readiness: [
      { id: "drill", label: "操练兵丁", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 5 }, { type: "resource", pillar: "nation", field: "borderPressure", delta: -2 }], treasuryDelta: -600 },
      { id: "repair_armories", label: "修葺武库", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 3 }], treasuryDelta: -800 },
      { id: "defer_readiness", label: "暂缓整备", effects: [{ type: "resource", pillar: "nation", field: "military", delta: -2 }] },
    ],
    border_fortification: [
      { id: "fortify_passes", label: "增修关隘", effects: [{ type: "resource", pillar: "nation", field: "borderPressure", delta: -7 }, { type: "resource", pillar: "nation", field: "military", delta: 2 }], treasuryDelta: -1200 },
      { id: "rotate_garrison", label: "轮戍边军", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 5 }], treasuryDelta: -700 },
      { id: "local_levy", label: "就地募兵", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 4 }] },
    ],
    frontier_incursion: [
      { id: "mobilize", label: "调兵出征", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 6 }], treasuryDelta: urgency === "critical" ? -2800 : -1800 },
      { id: "hold_line", label: "坚守待援", effects: [{ type: "resource", pillar: "nation", field: "military", delta: 3 }], treasuryDelta: urgency === "critical" ? -1800 : -1200 },
      { id: "negotiate", label: "遣使议和", effects: [{ type: "resource", pillar: "sovereign", field: "prestige", delta: -3 }], treasuryDelta: urgency === "critical" ? -1000 : -600 },
    ],
  };

  return {
    id: "mem_000001",
    category: "military",
    status: "pending",
    createdAt: atYear(1),
    sourceId: `military:${matter}:${theaterId}:1`,
    title: "边务奏报",
    summary: "请旨裁示。",
    payload: {
      category: "military",
      matter,
      urgency,
      theaterId,
      pressureAtCreation,
      militaryAtCreation,
      options: optionsByMatter[matter]!,
    },
  };
}

/** Treasury memorial for comparison. */
function makeTreasuryMemorial(urgency: "routine" | "urgent" = "routine"): Memorial {
  return {
    id: "mem_000001",
    category: "treasury",
    status: "pending",
    createdAt: atYear(1),
    sourceId: "treasury:annual_revenue_plan:1",
    title: "户部奏请",
    summary: "请旨。",
    payload: {
      category: "treasury",
      matter: "annual_revenue_plan",
      urgency,
      options: [
        { id: "audit", label: "清查", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "corruption", delta: -5 }], treasuryDelta: 600 },
        { id: "surtax", label: "加征", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "publicSupport", delta: -6 }], treasuryDelta: 1000 },
        { id: "defer", label: "暂缓", effects: [{ type: "resource" as const, pillar: "nation" as const, field: "corruption", delta: 2 }] },
      ],
    },
  };
}

// ── contextLabel ──────────────────────────────────────────────────────────────

describe("Group K: memorialCard — contextLabel", () => {
  it("annual_readiness routine → '军务 · 常例'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "annual_readiness", urgency: "routine" }), 10000);
    expect(card.contextLabel).toBe("军务 · 常例");
  });

  it("border_fortification routine → '军务 · 常例'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification", urgency: "routine" }), 10000);
    expect(card.contextLabel).toBe("军务 · 常例");
  });

  it("frontier_incursion urgent → '军务 · 边情紧迫'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "frontier_incursion", urgency: "urgent" }), 10000);
    expect(card.contextLabel).toBe("军务 · 边情紧迫");
  });

  it("frontier_incursion critical → '军务 · 军情告急'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "frontier_incursion", urgency: "critical" }), 10000);
    expect(card.contextLabel).toBe("军务 · 军情告急");
  });

  it("treasury routine → '度支 · 常例'", () => {
    const card = memorialCard(makeTreasuryMemorial("routine"), 10000);
    expect(card.contextLabel).toBe("度支 · 常例");
  });

  it("treasury urgent → '度支 · 急奏'", () => {
    const card = memorialCard(makeTreasuryMemorial("urgent"), 10000);
    expect(card.contextLabel).toBe("度支 · 急奏");
  });
});

// ── FIELD_LABEL (via effectSummary) ───────────────────────────────────────────

describe("Group K: memorialCard — FIELD_LABEL translations", () => {
  it("FIELD_LABEL borderPressure → effectSummary uses '边患压力' not raw 'borderPressure'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification" }), 10000);
    const allSummaries = card.options.map((o) => o.effectSummary).join(" ");
    expect(allSummaries).toContain("边患压力");
    expect(allSummaries).not.toContain("borderPressure");
  });

  it("FIELD_LABEL military → effectSummary uses '军力'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "annual_readiness" }), 10000);
    const allSummaries = card.options.map((o) => o.effectSummary).join(" ");
    expect(allSummaries).toContain("军力");
    expect(allSummaries).not.toContain("'military'");
  });

  it("FIELD_LABEL fatigue → effectSummary uses '疲劳'", () => {
    // Create a memorial with a fatigue effect
    const mem = makeMilitaryMemorial({ matter: "frontier_incursion", urgency: "urgent" });
    const p = mem.payload as any;
    p.options[0] = {
      ...p.options[0],
      effects: [{ type: "resource", pillar: "sovereign", field: "fatigue", delta: 2 }],
    };
    const card = memorialCard(mem, 10000);
    expect(card.options[0]!.effectSummary).toContain("疲劳");
  });

  it("FIELD_LABEL prestige → effectSummary uses '威望'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "frontier_incursion", urgency: "urgent" }), 10000);
    // negotiate has prestige effect
    const negotiateOption = card.options.find((o) => o.id === "negotiate")!;
    expect(negotiateOption?.effectSummary).toContain("威望");
  });
});

// ── formatBorderPressure (via borderPressureDesc) ─────────────────────────────

describe("Group K: memorialCard — formatBorderPressure (borderPressureDesc)", () => {
  function borderDesc(pressure: number): string {
    const card = memorialCard(makeMilitaryMemorial({ pressureAtCreation: pressure }), 10000);
    return card.borderPressureDesc ?? "";
  }

  it("pressure=0 → '边境安宁'", () => {
    expect(borderDesc(0)).toBe("边境安宁");
  });

  it("pressure=19 → '边境安宁' (≤19 range)", () => {
    expect(borderDesc(19)).toBe("边境安宁");
  });

  it("pressure=20 → '偶有骚动' (20–39 range)", () => {
    expect(borderDesc(20)).toBe("偶有骚动");
  });

  it("pressure=39 → '偶有骚动'", () => {
    expect(borderDesc(39)).toBe("偶有骚动");
  });

  it("pressure=40 → '边患渐起' (40–59 range)", () => {
    expect(borderDesc(40)).toBe("边患渐起");
  });

  it("pressure=59 → '边患渐起'", () => {
    expect(borderDesc(59)).toBe("边患渐起");
  });

  it("pressure=60 → '边情紧迫' (60–79 range)", () => {
    expect(borderDesc(60)).toBe("边情紧迫");
  });

  it("pressure=79 → '边情紧迫'", () => {
    expect(borderDesc(79)).toBe("边情紧迫");
  });

  it("pressure=80 → '烽烟四起' (≥80 range)", () => {
    expect(borderDesc(80)).toBe("烽烟四起");
  });

  it("pressure=100 → '烽烟四起'", () => {
    expect(borderDesc(100)).toBe("烽烟四起");
  });
});

// ── detailLines and theater ────────────────────────────────────────────────────

describe("Group K: memorialCard — detailLines and theater names", () => {
  it("detailLines includes theater name", () => {
    const card = memorialCard(makeMilitaryMemorial({ theaterId: "northern_frontier" }), 10000);
    expect(card.detailLines).toBeDefined();
    expect(card.detailLines!.some((l) => l.includes("北境"))).toBe(true);
  });

  it("theaterName for northern_frontier → '北境'", () => {
    const card = memorialCard(makeMilitaryMemorial({ theaterId: "northern_frontier" }), 10000);
    expect(card.theaterName).toBe("北境");
  });

  it("theaterName for western_frontier → '西陲'", () => {
    const card = memorialCard(makeMilitaryMemorial({ theaterId: "western_frontier" }), 10000);
    expect(card.theaterName).toBe("西陲");
  });

  it("theaterName for southern_frontier → '南疆'", () => {
    const card = memorialCard(makeMilitaryMemorial({ theaterId: "southern_frontier" }), 10000);
    expect(card.theaterName).toBe("南疆");
  });

  it("theaterId is set correctly", () => {
    const card = memorialCard(makeMilitaryMemorial({ theaterId: "western_frontier" }), 10000);
    expect(card.theaterId).toBe("western_frontier");
  });

  it("militaryAtCreation is set in card view", () => {
    const card = memorialCard(makeMilitaryMemorial({ militaryAtCreation: 65 }), 10000);
    expect(card.militaryAtCreation).toBe(65);
  });

  it("detailLines includes border pressure description", () => {
    const card = memorialCard(makeMilitaryMemorial({ pressureAtCreation: 65 }), 10000);
    expect(card.detailLines!.some((l) => l.includes("边情紧迫"))).toBe(true);
  });
});

// ── Treasury cost display ─────────────────────────────────────────────────────

describe("Group K: memorialCard — treasury cost display", () => {
  it("fortify_passes (cost -1200): treasuryCost present", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification" }), 10000);
    const opt = card.options.find((o) => o.id === "fortify_passes")!;
    expect(opt.treasuryCost).toBeDefined();
    expect(opt.treasuryCost).toContain("-1,200");
  });

  it("defer_readiness (no cost): no treasuryCost", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "annual_readiness" }), 10000);
    const opt = card.options.find((o) => o.id === "defer_readiness")!;
    expect(opt.treasuryCost).toBeUndefined();
  });

  it("local_levy (no cost): no treasuryCost", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification" }), 10000);
    const opt = card.options.find((o) => o.id === "local_levy")!;
    expect(opt.treasuryCost).toBeUndefined();
  });

  it("insufficient treasury: option is disabled", () => {
    // fortify_passes costs 1200, treasury=500 → disabled
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification" }), 500);
    const opt = card.options.find((o) => o.id === "fortify_passes")!;
    expect(opt.disabled).toBe(true);
    expect(opt.disabledReason).toBeDefined();
    expect(opt.disabledReason).toContain("700"); // shortfall = 1200 - 500 = 700
  });

  it("sufficient treasury: option not disabled", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification" }), 50000);
    const opt = card.options.find((o) => o.id === "fortify_passes")!;
    expect(opt.disabled).toBe(false);
  });
});

// ── Raw field names not visible ───────────────────────────────────────────────

describe("Group K: memorialCard — raw field names not in effectSummary", () => {
  it("effectSummary does not contain raw 'borderPressure'", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "border_fortification" }), 10000);
    for (const opt of card.options) {
      expect(opt.effectSummary).not.toContain("borderPressure");
    }
  });

  it("effectSummary does not contain raw 'military' (as key, uses '军力')", () => {
    const card = memorialCard(makeMilitaryMemorial({ matter: "annual_readiness" }), 10000);
    // The effectSummary should use '军力' not the raw field name 'military'
    for (const opt of card.options) {
      // Check that raw 'military' doesn't appear isolated (it might appear as part of other words)
      // We specifically check it's NOT outputting the raw field name unchanged
      const summary = opt.effectSummary;
      // "军力" contains "军" not "military"
      expect(summary).not.toMatch(/\bmilitary\b/);
    }
  });
});
