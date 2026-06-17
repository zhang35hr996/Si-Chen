import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { buildHeirSummon } from "../../src/store/heirInteraction";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function stateAt(year: number): { state: GameState; heir: Heir } {
  const s = createNewGameState(db);
  (s.calendar as { year: number }).year = year;
  const heir: Heir = {
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: true,
    petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  };
  s.resources.bloodline.heirs.push(heir);
  return { state: s, heir };
}

describe("buildHeirSummon", () => {
  it("returns +20 favor effect and stage-specific lines + portrait", () => {
    const { state, heir } = stateAt(1); // 0 岁 infant
    const plan = buildHeirSummon(db, state, heir.id)!;
    expect(plan.effects).toEqual([{ type: "heir_summon", heirId: heir.id }]);
    expect(plan.portraitSet).toBe("child_baby");
    expect(plan.lines.length).toBeGreaterThan(0);
  });

  it("schooling heir uses school portrait", () => {
    const { state, heir } = stateAt(6); // 5 岁 schooling
    const plan = buildHeirSummon(db, state, heir.id)!;
    expect(plan.portraitSet).toBe("child_school");
  });

  it("returns null for unknown heir", () => {
    const { state } = stateAt(1);
    expect(buildHeirSummon(db, state, "nope")).toBeNull();
  });
});
