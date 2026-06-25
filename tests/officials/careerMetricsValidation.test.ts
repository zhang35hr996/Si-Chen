/** validateOfficialWorld 对官员能力/履历越界的捕获（Phase 3 PR3C-1）。 */
import { describe, expect, it } from "vitest";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, Official } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);
const patchOff = (s: GameState, patch: Partial<Official>): GameState => {
  const id = Object.keys(s.officials)[0]!;
  return { ...s, officials: { ...s.officials, [id]: { ...s.officials[id]!, ...patch } } };
};

describe("aptitude / reviewState invariants", () => {
  it("a clean world validates", () => {
    expect(validateOfficialWorld(createNewGameState(db, 1), db)).toEqual([]);
  });

  it("out-of-range aptitude → OFFICIAL_BAD_APTITUDE", () => {
    const s = createNewGameState(db, 1);
    expect(codes(patchOff(s, { aptitude: { governance: 150, scholarship: 50, military: 50, integrity: 50 } }))).toContain("OFFICIAL_BAD_APTITUDE");
    expect(codes(patchOff(s, { aptitude: { governance: -1, scholarship: 50, military: 50, integrity: 50 } }))).toContain("OFFICIAL_BAD_APTITUDE");
  });

  it("out-of-range merit / negative underperformance → OFFICIAL_BAD_REVIEW_STATE", () => {
    const s = createNewGameState(db, 1);
    expect(codes(patchOff(s, { reviewState: { merit: 200, underperformanceYears: 0 } }))).toContain("OFFICIAL_BAD_REVIEW_STATE");
    expect(codes(patchOff(s, { reviewState: { merit: 50, underperformanceYears: -2 } }))).toContain("OFFICIAL_BAD_REVIEW_STATE");
  });
});
