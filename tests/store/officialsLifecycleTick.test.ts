import { describe, expect, it } from "vitest";
import { buildOfficialYearlyTick } from "../../src/store/officialsLifecycleTick";
import { GameStore } from "../../src/store/gameStore";
import { getActiveSeatedOfficials } from "../../src/engine/officials/selectors";
import { validateOfficialWorld, validateGeneratedAges } from "../../src/engine/officials/validation";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed");
const db = content.value;
const tickTime = (y: number) => ({ year: y, month: 1, period: "early" as const, dayIndex: 0 });

function runYears(s: GameState, from: number, to: number): GameState {
  let next = s;
  for (let y = from; y <= to; y++) next = buildOfficialYearlyTick(next, db, tickTime(y));
  return next;
}

describe("buildOfficialYearlyTick — determinism & validity", () => {
  it("same seed → identical officials/history/pending", () => {
    const a = runYears(createNewGameState(db, 7), 2, 8);
    const b = runYears(createNewGameState(db, 7), 2, 8);
    expect(a.officials).toEqual(b.officials);
    expect(a.officialHistory).toEqual(b.officialHistory);
    expect(a.pendingRetirements).toEqual(b.pendingRetirements);
    expect(a.familyMembers).toEqual(b.familyMembers);
  });

  it("seed sweep: world stays valid through 30 years (seeds 1..40)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = createNewGameState(db, seed);
      expect(validateGeneratedAges(s, db)).toEqual([]); // generation-time age plausibility
      for (let y = 2; y <= 31; y++) {
        s = buildOfficialYearlyTick(s, db, tickTime(y));
        const errs = validateOfficialWorld(s, db);
        if (errs.length) throw new Error(`seed ${seed} year ${y}: ${errs.map((e) => e.code).join(",")}`);
      }
    }
  });

  it("ages survivors by exactly 1 each year; dead freeze", () => {
    const s0 = createNewGameState(db, 3);
    const before = Object.fromEntries(Object.values(s0.officials).map((o) => [o.id, o.age]));
    const s1 = buildOfficialYearlyTick(s0, db, tickTime(2));
    for (const o of Object.values(s1.officials)) {
      expect(o.age).toBe(o.status === "dead" ? before[o.id]! + 0 : before[o.id]! + 1);
    }
  });

  it("eventually produces natural deaths over many years", () => {
    const s = runYears(createNewGameState(db, 5), 2, 40);
    expect(Object.values(s.officials).some((o) => o.status === "dead")).toBe(true);
    expect(s.officialHistory.some((h) => h.status === "dead" && h.reason === "natural_death")).toBe(true);
  });

  it("generates retirement requests for aged active officials (deterministic, age-driven)", () => {
    const base = createNewGameState(db, 5);
    // 把所有官员设到 69 岁：tick 增龄到 70（告老几率 60%）→ 幸存者中必有人请辞。
    const officials = Object.fromEntries(
      Object.entries(base.officials).map(([id, o]) => [id, { ...o, age: 69 }]),
    );
    const s = buildOfficialYearlyTick({ ...base, officials }, db, tickTime(2));
    expect(s.pendingRetirements.length).toBeGreaterThan(0);
    for (const p of s.pendingRetirements) {
      expect(s.officials[p.officialId]!.status).toBe("active"); // 请辞者仍在任
    }
  });

  it("age never exceeds 120 across 200 years; schema/validator/round-trip stay green (seeds 1..15)", () => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = createNewGameState(db, seed);
      for (let y = 2; y <= 201; y++) {
        s = buildOfficialYearlyTick(s, db, tickTime(y));
        for (const o of Object.values(s.officials)) expect(o.age).toBeLessThanOrEqual(120);
        for (const m of Object.values(s.familyMembers)) expect(m.age).toBeLessThanOrEqual(120);
      }
      expect(validateOfficialWorld(s, db)).toEqual([]);
      expect(gameStateSchema.safeParse(s).success).toBe(true);
    }
  });

  it("a 119-yo survivor reaches 120 next tick and necessarily dies", () => {
    const base = createNewGameState(db, 2);
    const id = Object.keys(base.officials)[0]!;
    const officials = { ...base.officials, [id]: { ...base.officials[id]!, age: 119 } };
    const s = buildOfficialYearlyTick({ ...base, officials }, db, tickTime(2));
    expect(s.officials[id]!.age).toBe(120);
    expect(s.officials[id]!.status).toBe("dead");
  });

  it("a compat 120-yo survivor stays ≤120 and dies after a tick", () => {
    const base = createNewGameState(db, 2);
    const id = Object.keys(base.officials)[0]!;
    const officials = { ...base.officials, [id]: { ...base.officials[id]!, age: 120 } };
    const s = buildOfficialYearlyTick({ ...base, officials }, db, tickTime(2));
    expect(s.officials[id]!.age).toBeLessThanOrEqual(120);
    expect(s.officials[id]!.status).toBe("dead");
  });

  it("dead officials are excluded from the active-seated source", () => {
    const s = runYears(createNewGameState(db, 5), 2, 40);
    const active = new Set(getActiveSeatedOfficials(s, db).map((o) => o.id));
    for (const o of Object.values(s.officials)) {
      if (o.status === "dead") expect(active.has(o.id)).toBe(false);
    }
  });
});

describe("yearly tick fires through the time transaction", () => {
  it("crossing into a new year ages officials exactly once", () => {
    const store = new GameStore();
    store.loadState(createNewGameState(db, 9));
    const before = Object.fromEntries(Object.values(store.getState().officials).map((o) => [o.id, o.age]));

    let guard = 0;
    while (store.getState().calendar.year < 2 && guard < 80) {
      const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
      if (!r.ok) break;
      if (r.value.healthOutcome?.sovereignDied) break;
      guard += 1;
    }
    expect(store.getState().calendar.year).toBeGreaterThanOrEqual(2);
    for (const o of Object.values(store.getState().officials)) {
      expect(o.age).toBe(o.status === "dead" ? before[o.id]! : before[o.id]! + 1);
    }
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });
});
