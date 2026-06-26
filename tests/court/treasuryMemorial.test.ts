/**
 * Groups C+D: 财政奏折生成（generateTreasuryMemorial / maybeGenerateAnnualTreasuryMemorial）
 * 及年度 seam（GameStore.advanceTime 在四月生成奏折）。
 */
import { describe, expect, it } from "vitest";
import {
  generateTreasuryMemorial,
  maybeGenerateAnnualTreasuryMemorial,
  TREASURY_OPTION_IDS,
  validateMemorials,
  resolveMemorial,
  getPendingMemorials,
} from "../../src/engine/court/memorials";
import { validateTreasuryLedger } from "../../src/engine/court/treasuryLedger";
import { createNewGameState } from "../../src/engine/state/newGame";
import { GameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";
import { dayIndexOf, toGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const AT_APRIL = { year: 2, month: 4, period: "early" as const, dayIndex: dayIndexOf(2, 4, "early") };

function stateWithTreasury(treasury: number): GameState {
  const base = createNewGameState(db, 1);
  return { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury } } };
}

// ── Group C: 生成 ─────────────────────────────────────────────────────────────

describe("Group C: generateTreasuryMemorial — generation", () => {
  it("routine payload when treasury ≥ 3000", () => {
    const state = stateWithTreasury(10000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    expect(r).not.toBeNull();
    expect(r.memorial.category).toBe("treasury");
    expect(r.memorial.status).toBe("pending");
    if (r.memorial.payload.category !== "treasury") return;
    expect(r.memorial.payload.urgency).toBe("routine");
    expect(r.memorial.payload.matter).toBe("annual_revenue_plan");
  });

  it("urgent payload when treasury < 3000", () => {
    const state = stateWithTreasury(2999);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    expect(r).not.toBeNull();
    if (r.memorial.payload.category !== "treasury") return;
    expect(r.memorial.payload.urgency).toBe("urgent");
    expect(r.memorial.title).toContain("筹饷");
  });

  it("exactly 3000 → routine", () => {
    const state = stateWithTreasury(3000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    expect(r).not.toBeNull();
    if (r.memorial.payload.category !== "treasury") return;
    expect(r.memorial.payload.urgency).toBe("routine");
  });

  it("three option IDs match TREASURY_OPTION_IDS", () => {
    const state = stateWithTreasury(10000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    const ids = r.memorial.payload.options.map((o) => o.id);
    expect(ids).toEqual([...TREASURY_OPTION_IDS]);
  });

  it("routine audit values: treasury +600, corruption -5, governance +2, ministerLoyalty -2", () => {
    const state = stateWithTreasury(10000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    const audit = r.memorial.payload.options.find((o) => o.id === "audit")!;
    expect(audit.treasuryDelta).toBe(600);
    const corruption = audit.effects.find((e) => e.field === "corruption")!;
    const governance = audit.effects.find((e) => e.field === "governance")!;
    const ministerLoyalty = audit.effects.find((e) => e.field === "ministerLoyalty")!;
    expect(corruption.delta).toBe(-5);
    expect(governance.delta).toBe(2);
    expect(ministerLoyalty.delta).toBe(-2);
  });

  it("urgent audit values: treasury +1200, corruption -6, ministerLoyalty -3", () => {
    const state = stateWithTreasury(2000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    const audit = r.memorial.payload.options.find((o) => o.id === "audit")!;
    expect(audit.treasuryDelta).toBe(1200);
    const corruption = audit.effects.find((e) => e.field === "corruption")!;
    const ministerLoyalty = audit.effects.find((e) => e.field === "ministerLoyalty")!;
    expect(corruption.delta).toBe(-6);
    expect(ministerLoyalty.delta).toBe(-3);
  });

  it("routine surtax values: treasury +1000, publicSupport -6, productivity -3, rumor +2", () => {
    const state = stateWithTreasury(10000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    const surtax = r.memorial.payload.options.find((o) => o.id === "surtax")!;
    expect(surtax.treasuryDelta).toBe(1000);
    const ps = surtax.effects.find((e) => e.field === "publicSupport")!;
    const prod = surtax.effects.find((e) => e.field === "productivity")!;
    const rumor = surtax.effects.find((e) => e.field === "rumor")!;
    expect(ps.delta).toBe(-6);
    expect(prod.delta).toBe(-3);
    expect(rumor.delta).toBe(2);
  });

  it("urgent surtax values: treasury +1800, publicSupport -8, productivity -4, rumor +3", () => {
    const state = stateWithTreasury(2000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    const surtax = r.memorial.payload.options.find((o) => o.id === "surtax")!;
    expect(surtax.treasuryDelta).toBe(1800);
    const ps = surtax.effects.find((e) => e.field === "publicSupport")!;
    const prod = surtax.effects.find((e) => e.field === "productivity")!;
    const rumor = surtax.effects.find((e) => e.field === "rumor")!;
    expect(ps.delta).toBe(-8);
    expect(prod.delta).toBe(-4);
    expect(rumor.delta).toBe(3);
  });

  it("defer: no treasuryDelta, corruption +2, governance -2", () => {
    const state = stateWithTreasury(10000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    const defer = r.memorial.payload.options.find((o) => o.id === "defer")!;
    expect(defer.treasuryDelta).toBeUndefined();
    const corruption = defer.effects.find((e) => e.field === "corruption")!;
    const governance = defer.effects.find((e) => e.field === "governance")!;
    expect(corruption.delta).toBe(2);
    expect(governance.delta).toBe(-2);
  });

  it("sourceId dedup: pending memorial prevents regeneration (same year)", () => {
    const state = stateWithTreasury(10000);
    const first = generateTreasuryMemorial(state, AT_APRIL)!;
    expect(generateTreasuryMemorial(first.state, AT_APRIL)).toBeNull();
  });

  it("sourceId dedup: resolved memorial prevents regeneration (same year)", () => {
    const state = stateWithTreasury(10000);
    const gen = generateTreasuryMemorial(state, AT_APRIL)!;
    const resolved = resolveMemorial(gen.state, db, gen.memorial.id, "defer", AT_APRIL);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(generateTreasuryMemorial(resolved.value.state, AT_APRIL)).toBeNull();
  });

  it("pending treasury memorial gates new generation (different year, still pending)", () => {
    const state = stateWithTreasury(10000);
    const gen = generateTreasuryMemorial(state, AT_APRIL)!;
    // Try to generate for next year — still blocked by the existing pending treasury memorial
    const nextYearAt = { ...AT_APRIL, year: AT_APRIL.year + 1 };
    expect(generateTreasuryMemorial(gen.state, nextYearAt)).toBeNull();
  });

  it("deterministic: same state → same result", () => {
    const state = stateWithTreasury(10000);
    const r1 = generateTreasuryMemorial(state, AT_APRIL)!;
    const r2 = generateTreasuryMemorial(state, AT_APRIL)!;
    expect(JSON.stringify(r1.memorial)).toBe(JSON.stringify(r2.memorial));
  });

  it("max ID used: new memorial gets next sequential ID", () => {
    const base = createNewGameState(db, 1);
    // Inject a memorial with id mem_000003 to test max ID tracking
    const existing: GameState = {
      ...base,
      memorials: {
        "mem_000003": {
          id: "mem_000003",
          category: "disaster",
          status: "resolved",
          createdAt: AT_APRIL,
          resolvedAt: AT_APRIL,
          resolution: "ignore",
          sourceId: "disaster:jiangnan:1",
          title: "Test",
          summary: "Test",
          payload: { category: "disaster", regionId: "jiangnan", severity: "minor", options: [
            { id: "ignore", label: "无", effects: [] },
          ] },
        },
      },
    };
    const r = generateTreasuryMemorial(existing, AT_APRIL)!;
    expect(r.memorial.id).toBe("mem_000004");
  });

  it("generated state passes validateMemorials", () => {
    const state = stateWithTreasury(10000);
    const r = generateTreasuryMemorial(state, AT_APRIL)!;
    expect(validateMemorials(r.state)).toEqual([]);
  });
});

// ── Group C: maybeGenerateAnnualTreasuryMemorial ─────────────────────────────

describe("Group C: maybeGenerateAnnualTreasuryMemorial", () => {
  it("returns new state with memorial when conditions met", () => {
    const state = stateWithTreasury(10000);
    const after = maybeGenerateAnnualTreasuryMemorial(state, AT_APRIL);
    expect(Object.keys(after.memorials)).toHaveLength(1);
    const m = Object.values(after.memorials)[0]!;
    expect(m.category).toBe("treasury");
  });

  it("returns input state when dedup prevents generation", () => {
    const state = stateWithTreasury(10000);
    const first = maybeGenerateAnnualTreasuryMemorial(state, AT_APRIL);
    const second = maybeGenerateAnnualTreasuryMemorial(first, AT_APRIL);
    expect(Object.keys(second.memorials)).toHaveLength(1); // still only one
    expect(second).toBe(first); // same object reference
  });
});

// ── Group D: production seam ─────────────────────────────────────────────────

describe("Group D: annual treasury seam — production-reachable", () => {
  function storeAtMonth3(): GameStore {
    const store = new GameStore();
    const s = createNewGameState(db, 1);
    // Advance to year 2, month 3, late, 1 AP left
    store.loadState({
      ...s,
      calendar: {
        ...s.calendar,
        year: 2,
        month: 3,
        period: "late" as const,
        dayIndex: dayIndexOf(2, 3, "late"),
        ap: 1,
      },
    });
    return store;
  }

  it("crossing month 3→4 generates treasury memorial", () => {
    const store = storeAtMonth3();
    expect(getPendingMemorials(store.getState()).filter((m) => m.category === "treasury")).toHaveLength(0);

    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.month).toBe(4);

    const pending = getPendingMemorials(store.getState()).filter((m) => m.category === "treasury");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.category).toBe("treasury");
    expect(validateMemorials(store.getState())).toEqual([]);
  });

  it("same year: idempotent — advancing again in month 4 does not create second memorial", () => {
    const store = storeAtMonth3();
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    const countAfter = Object.keys(store.getState().memorials).length;
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    expect(Object.keys(store.getState().memorials).length).toBe(countAfter);
  });

  it("next year if resolved: can generate again", () => {
    const store = storeAtMonth3();
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const m = getPendingMemorials(store.getState()).find((m) => m.category === "treasury")!;
    expect(m).toBeDefined();

    // Resolve the memorial
    const r = store.resolveMemorial(db, m.id, "defer");
    expect(r.ok).toBe(true);

    // Advance to next year's April (year 3, month 3, late, 1 AP → then month 4)
    const s = store.getState();
    store.loadState({
      ...s,
      calendar: {
        ...s.calendar,
        year: 3,
        month: 3,
        period: "late" as const,
        dayIndex: dayIndexOf(3, 3, "late"),
        ap: 1,
      },
    });
    const prevCount = Object.keys(store.getState().memorials).length;
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const newTreasuryMemorials = getPendingMemorials(store.getState()).filter(
      (m) => m.category === "treasury",
    );
    expect(newTreasuryMemorials).toHaveLength(1);
    expect(Object.keys(store.getState().memorials).length).toBeGreaterThan(prevCount);
  });

  it("next year if still pending: cannot generate", () => {
    const store = storeAtMonth3();
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    // Pending memorial from year 2 — do NOT resolve

    // Advance to year 3, month 3→4
    const s = store.getState();
    store.loadState({
      ...s,
      calendar: {
        ...s.calendar,
        year: 3,
        month: 3,
        period: "late" as const,
        dayIndex: dayIndexOf(3, 3, "late"),
        ap: 1,
      },
    });
    const prevCount = Object.keys(store.getState().memorials).length;
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    // Still only one pending treasury memorial (the original from year 2)
    const treasuryMemorials = Object.values(store.getState().memorials).filter(
      (m) => m.category === "treasury",
    );
    expect(treasuryMemorials).toHaveLength(1);
    expect(Object.keys(store.getState().memorials).length).toBe(prevCount);
  });

  it("resolve through store: audit option increases treasury and writes ledger", () => {
    const store = storeAtMonth3();
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const m = getPendingMemorials(store.getState()).find((m) => m.category === "treasury")!;
    expect(m).toBeDefined();

    const before = store.getState().resources.nation.treasury;
    const r = store.resolveMemorial(db, m.id, "audit");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(store.getState().resources.nation.treasury).toBeGreaterThan(before);
    expect(store.getState().treasuryLedger).toHaveLength(1);
    expect(store.getState().treasuryLedger[0]!.delta).toBeGreaterThan(0);
    expect(validateTreasuryLedger(store.getState())).toEqual([]);
  });
});
