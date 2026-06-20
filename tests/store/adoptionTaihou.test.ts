import { describe, expect, it } from "vitest";
import { eligibleAdoptiveFathers, buildAdoptionReaction } from "../../src/store/adoption";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
  birthAt: makeGameTime(1, 1, "early"),
  favor: 50, legitimate: false, petName: "", education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20, faction: "none",
  ...over,
});

describe("养父池含太后", () => {
  it("eligibleAdoptiveFathers includes taihou", () => {
    const s = createNewGameState(db);
    expect(eligibleAdoptiveFathers(db, s).some((c) => c.id === "taihou")).toBe(true);
  });

  it("太后养父：单段欣然，无谢恩、无生父泪报（即便生父尚在宫）", () => {
    const s = createNewGameState(db);
    const h = heir({ fatherId: "xu_qinghuan" }); // bio father in palace
    const beats = buildAdoptionReaction(db, s, h, "taihou");
    expect(beats.length).toBe(1);
    expect(beats[0]!.speakerId).toBe("taihou");
    expect(beats.some((b) => b.speakerId === "wei_sui")).toBe(false);
  });
});
