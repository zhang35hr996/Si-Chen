import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateOfficialWorld } from "../../src/engine/officials/worldgen";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { isValidOfficialAge } from "../../src/engine/officials/constraints";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

describe("seed sweep — every generated world is valid (seed 1..500)", () => {
  it("passes validateOfficialWorld for all seeds with no throws", () => {
    const offenders: Array<{ seed: number; codes: string[] }> = [];
    for (let seed = 1; seed <= 500; seed++) {
      // generation 必不抛错（年龄窗口非空）。
      expect(() => generateOfficialWorld(db, seed, T)).not.toThrow();
      const state = createNewGameState(db, seed);
      const errs = validateOfficialWorld(state, db);
      if (errs.length > 0) offenders.push({ seed, codes: errs.map((e) => e.code) });
      // 官员年龄合规（不止 >= 1）。
      for (const o of Object.values(state.officials)) {
        expect(isValidOfficialAge(o.age)).toBe(true);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("seed 4 regression: deterministic and valid (previously produced an out-of-range child age)", () => {
    const a = generateOfficialWorld(db, 4, T);
    const b = generateOfficialWorld(db, 4, T);
    expect(a).toEqual(b);
    const state = createNewGameState(db, 4);
    expect(validateOfficialWorld(state, db)).toEqual([]);
  });
});
