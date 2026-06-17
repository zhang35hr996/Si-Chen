import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { eligibleAdoptiveFathers, bioFatherAvailable, buildAdoptionReaction } from "../../src/store/adoption";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
  birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
  favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 }, ...over,
});

describe("eligibleAdoptiveFathers", () => {
  it("includes in-palace consorts + 凤后, excludes 冷宫 + deceased + officials", () => {
    const s = createNewGameState(db);
    const ids = eligibleAdoptiveFathers(db, s).map((c) => c.id);
    expect(ids).toContain("feng_hou");
    expect(ids).toContain("shen_chenghui");
    expect(ids).not.toContain("wenya_shijun"); // 冷宫
    expect(ids).not.toContain("sili_nvguan"); // official
  });
});

describe("bioFatherAvailable", () => {
  it("false for self-conceived (fatherId null)", () => {
    const s = createNewGameState(db);
    expect(bioFatherAvailable(db, s, heir({ fatherId: null }))).toBe(false);
  });
  it("false when bio father deceased or in 冷宫", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.lifecycle = "deceased";
    expect(bioFatherAvailable(db, s, heir({ fatherId: "shen_chenghui" }))).toBe(false);
    expect(bioFatherAvailable(db, createNewGameState(db), heir({ fatherId: "wenya_shijun" }))).toBe(false);
  });
  it("true when bio father alive and in palace", () => {
    const s = createNewGameState(db);
    expect(bioFatherAvailable(db, s, heir({ fatherId: "shen_chenghui" }))).toBe(true);
  });
});

describe("buildAdoptionReaction", () => {
  it("no-bio-father path: adoptive father thanks (single speaker)", () => {
    const s = createNewGameState(db);
    const out = buildAdoptionReaction(db, s, heir({ fatherId: null }), "shen_chenghui");
    expect(out).toHaveLength(1);
    expect(out[0]!.speakerId).toBe("shen_chenghui");
  });
  it("bio-father-alive path: adoptive thanks + 司礼官 reports bio father weeps", () => {
    const s = createNewGameState(db);
    const out = buildAdoptionReaction(db, s, heir({ fatherId: "chu_jun" }), "shen_chenghui");
    expect(out).toHaveLength(2);
    expect(out[0]!.speakerId).toBe("shen_chenghui");
    expect(out[1]!.speakerId).toBe("sili_nvguan");
    expect(out[1]!.lines.join("")).toContain("生父");
  });
});
