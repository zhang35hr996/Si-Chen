import { describe, expect, it } from "vitest";
import { taihouIllnessChance, buildTaihouIllnessTick, buildShizhiEncounter } from "../../src/store/taihou";
import type { GameState } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

function stateWith(over: { ill: boolean; year: number }): GameState {
  return {
    calendar: { year: over.year, month: 1, period: "early", apMax: 6, ap: 6, dayIndex: 0 },
    taihou: { ill: over.ill },
  } as unknown as GameState;
}

describe("taihouIllnessChance", () => {
  it("元年 5%, 逐年 +1%, 封顶 25%", () => {
    expect(taihouIllnessChance(1)).toBe(5);
    expect(taihouIllnessChance(2)).toBe(6);
    expect(taihouIllnessChance(21)).toBe(25);
    expect(taihouIllnessChance(40)).toBe(25);
  });
});

describe("buildTaihouIllnessTick", () => {
  it("not ill: a hitting seed produces set_taihou_illness{ill:true} + a prompt beat", () => {
    let hitSeed = "";
    for (let i = 0; i < 500; i++) {
      const tick = buildTaihouIllnessTick(stateWith({ ill: false, year: 1 }), `probe:${i}`);
      if (tick && tick.effects.some((e) => e.type === "set_taihou_illness" && e.ill === true)) { hitSeed = `probe:${i}`; break; }
    }
    expect(hitSeed).not.toBe("");
    const tick = buildTaihouIllnessTick(stateWith({ ill: false, year: 1 }), hitSeed)!;
    expect(tick.beats.length).toBeGreaterThan(0);
  });

  it("deterministic: same state+seed → same result", () => {
    const a = buildTaihouIllnessTick(stateWith({ ill: false, year: 3 }), "k1");
    const b = buildTaihouIllnessTick(stateWith({ ill: false, year: 3 }), "k1");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("ill: a hitting recover seed produces set_taihou_illness{ill:false}, no prompt", () => {
    let seed = "";
    for (let i = 0; i < 200; i++) {
      const tick = buildTaihouIllnessTick(stateWith({ ill: true, year: 1 }), `r:${i}`);
      if (tick && tick.effects.some((e) => e.type === "set_taihou_illness" && e.ill === false)) { seed = `r:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const tick = buildTaihouIllnessTick(stateWith({ ill: true, year: 1 }), seed)!;
    expect(tick.beats.length).toBe(0);
  });
});

describe("buildShizhiEncounter", () => {
  const loaded = loadGameContent();
  const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

  it("null when 太后 not ill", () => {
    const s = createNewGameState(db);
    s.taihou.ill = false;
    expect(buildShizhiEncounter(db, s, "1:1:early")).toBeNull();
  });

  it("when ill + hitting gate: picks an attendant, cures 太后, +5 favor", () => {
    const s = createNewGameState(db);
    s.taihou.ill = true;
    let seed = "";
    for (let i = 0; i < 200; i++) {
      const plan = buildShizhiEncounter(db, s, `g:${i}`);
      if (plan) { seed = `g:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const plan = buildShizhiEncounter(db, s, seed)!;
    expect(db.characters[plan.attendantId]).toBeDefined();
    expect(plan.effects.some((e) => e.type === "set_taihou_illness" && e.ill === false)).toBe(true);
    expect(plan.effects.some((e) => e.type === "favor" && e.char === plan.attendantId && e.delta === 5)).toBe(true);
    expect(plan.beats.length).toBe(3);
  });

  it("deterministic", () => {
    const s = createNewGameState(db);
    s.taihou.ill = true;
    expect(JSON.stringify(buildShizhiEncounter(db, s, "k"))).toBe(JSON.stringify(buildShizhiEncounter(db, s, "k")));
  });
});
