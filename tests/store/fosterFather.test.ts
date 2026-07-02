import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { eligibleFosterFathers, bioFatherAvailable, buildFosterFatherReaction } from "../../src/store/fosterFather";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";
import type { GameState, Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
  birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
  favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
  personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
  interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
  portraitVariants: { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" },
  ...over,
});

/** Helper: set parentage for an heir in state (biological parents). */
function withParentage(state: GameState, heirId: string, biologicalFatherId: string | null): GameState {
  state.parentage[heirId] = {
    biologicalMotherId: "sovereign",
    biologicalFatherId,
    legalMotherId: "sovereign",
    legalFatherId: biologicalFatherId,
  };
  return state;
}

/** Base state with the story consorts these tests reference injected (shen empress,
 *  lu/xu in-palace, wenya in 冷宫 via her changmengong defaultLocation). */
const fresh = () =>
  ["shen_zhibai", "lu_huaijin", "xu_qinghuan", "wenya"].reduce(
    (s, id) => withConsort(s, db, id),
    createNewGameState(db),
  );

describe("eligibleFosterFathers", () => {
  it("includes in-palace consorts + 皇后, excludes 冷宫 + deceased + officials", () => {
    const s = fresh();
    const ids = eligibleFosterFathers(db, s).map((c) => c.id);
    expect(ids).toContain("shen_zhibai");
    expect(ids).toContain("lu_huaijin");
    expect(ids).not.toContain("wenya"); // 冷宫
    expect(ids).not.toContain("wei_sui"); // official
  });

  it("production-shaped runtime db (generatedConsorts merged into characters) lists each consort once", () => {
    const s = fresh();
    const runtimeDb = { ...db, characters: { ...db.characters, ...s.generatedConsorts } };
    const ids = eligibleFosterFathers(runtimeDb, s).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toContain("lu_huaijin");
  });
});

describe("bioFatherAvailable", () => {
  it("false when no parentage record (damaged/missing)", () => {
    const s = createNewGameState(db);
    // No parentage set for heir_000001 → getBiologicalParents returns undefined
    expect(bioFatherAvailable(db, s, heir({ fatherId: null }))).toBe(false);
  });
  it("false for self-conceived (biologicalFatherId null)", () => {
    const s = withParentage(createNewGameState(db), "heir_000001", null);
    expect(bioFatherAvailable(db, s, heir({ fatherId: null }))).toBe(false);
  });
  it("false when bio father deceased or in 冷宫", () => {
    const sDeceased = withParentage(withConsort(createNewGameState(db), db, "lu_huaijin"), "heir_000001", "lu_huaijin");
    sDeceased.standing.lu_huaijin!.lifecycle = "deceased";
    expect(bioFatherAvailable(db, sDeceased, heir({ fatherId: "lu_huaijin" }))).toBe(false);
    const sColdPalace = withParentage(withConsort(createNewGameState(db), db, "wenya"), "heir_000001", "wenya");
    expect(bioFatherAvailable(db, sColdPalace, heir({ fatherId: "wenya" }))).toBe(false);
  });
  it("true when bio father alive and in palace", () => {
    const s = withParentage(withConsort(createNewGameState(db), db, "lu_huaijin"), "heir_000001", "lu_huaijin");
    expect(bioFatherAvailable(db, s, heir({ fatherId: "lu_huaijin" }))).toBe(true);
  });
});

describe("buildFosterFatherReaction", () => {
  it("no-bio-father path: foster father thanks (single speaker)", () => {
    const s = withConsort(createNewGameState(db), db, "lu_huaijin");
    // No parentage → bioFatherAvailable returns false → single speaker
    const h = heir({ fatherId: null });
    const out = buildFosterFatherReaction(db, s, h, "lu_huaijin");
    expect(out).toHaveLength(1);
    expect(out[0]!.speakerId).toBe("lu_huaijin");
  });
  it("bio-father-alive path: foster father thanks + 司礼官 reports bio father weeps", () => {
    const s = withParentage(fresh(), "heir_000001", "xu_qinghuan");
    const h = heir({ fatherId: "xu_qinghuan" });
    const out = buildFosterFatherReaction(db, s, h, "lu_huaijin");
    expect(out).toHaveLength(2);
    expect(out[0]!.speakerId).toBe("lu_huaijin");
    // The foster father's line must render her resolved name, not the raw generated id.
    const thanks = out[0]!.lines.join("");
    expect(thanks).not.toContain("lu_huaijin");
    expect(thanks).toContain("陆");
    expect(out[1]!.speakerId).toBe("wei_sui");
    expect(out[1]!.lines.join("")).toContain("泪如雨下");
  });
});
