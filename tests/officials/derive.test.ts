import { describe, expect, it } from "vitest";
import { familyText, maternalHead, maternalLoyalty, maternalPower } from "../../src/engine/officials/derive";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);
const xu = db.characters["xu_qinghuan"]!; // surname 徐, maternalClan{bingbu_shangshu, 嫡, 次}

describe("maternal derivations", () => {
  it("familyText = 品级+官职+嫡庶+排行子", () => {
    expect(familyText(db, state, xu)).toBe("从二品兵部尚书嫡次子");
  });
  it("maternalPower equals the head's powerOf; loyalty equals head loyalty", () => {
    const head = maternalHead(state, xu)!;
    expect(head.surname).toBe("徐");
    expect(maternalLoyalty(state, xu)).toBe(head.loyalty);
    expect(maternalPower(db, state, xu)).toBeGreaterThan(0);
  });
  it("a consort with no birth family reads 平民之子 / 0", () => {
    // 良家子：id 不在 standing 中 → 无 birthFamilyId → 无母族当家官员。
    const fake = { ...xu, id: "liangjia_zi_test", maternalClan: undefined, profile: { ...xu.profile, surname: undefined } };
    expect(familyText(db, state, fake)).toBe("平民之子");
    expect(maternalPower(db, state, fake)).toBe(0);
    expect(maternalLoyalty(state, fake)).toBe(0);
  });
});
