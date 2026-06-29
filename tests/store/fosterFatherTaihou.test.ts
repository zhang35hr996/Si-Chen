import { describe, expect, it } from "vitest";
import { eligibleFosterFathers, buildFosterFatherReaction } from "../../src/store/fosterFather";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
  birthAt: makeGameTime(1, 1, "early"),
  favor: 50, legitimate: false, petName: "", education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
  personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
  interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
  portraitVariants: { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" },
  ...over,
});

/** Helper: set parentage for an heir in state (biological father). */
function withParentage(state: GameState, heirId: string, biologicalFatherId: string | null): GameState {
  state.parentage[heirId] = {
    biologicalMotherId: "sovereign",
    biologicalFatherId,
    legalMotherId: "sovereign",
    legalFatherId: biologicalFatherId,
  };
  return state;
}

describe("抚养父候选池含太后", () => {
  it("eligibleFosterFathers includes taihou", () => {
    const s = createNewGameState(db);
    expect(eligibleFosterFathers(db, s).some((c) => c.id === "taihou")).toBe(true);
  });

  it("太后抚养父：单段欣然，无谢恩、无生父泪报（即便生父尚在宫）", () => {
    const s = withParentage(createNewGameState(db), "heir_000001", "xu_qinghuan"); // bio father in palace
    const h = heir({ fatherId: "xu_qinghuan" });
    const beats = buildFosterFatherReaction(db, s, h, "taihou");
    expect(beats.length).toBe(1);
    expect(beats[0]!.speakerId).toBe("taihou");
    expect(beats.some((b) => b.speakerId === "wei_sui")).toBe(false);
  });
});
