import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import {
  heirName, heirAge, nextHeirId, listHeirsBySex,
  heirAgeMonths, heirStage, centennialDue, isEnrolled, heirPortraitSet,
} from "../../src/engine/characters/heirs";
import type { Heir } from "../../src/engine/state/types";

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001",
  sex: "daughter",
  fatherId: null,
  bearer: "sovereign",
  birthAt: makeGameTime(1, 5, "early"),
  favor: 50,
  legitimate: true,
  petName: "",
  education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20, faction: "none",
  ...over,
});

describe("heirName", () => {
  it("ordinal 1→大, 2→二, 3→三 with 皇子/皇郎", () => {
    expect(heirName("daughter", 1)).toBe("大皇子");
    expect(heirName("daughter", 2)).toBe("二皇子");
    expect(heirName("son", 1)).toBe("大皇郎");
    expect(heirName("son", 3)).toBe("三皇郎");
  });
});

describe("listHeirsBySex", () => {
  it("orders by birth and numbers each sex table independently", () => {
    const heirs: Heir[] = [
      heir({ id: "heir_000001", sex: "daughter", birthAt: makeGameTime(1, 2, "early") }),
      heir({ id: "heir_000002", sex: "son", birthAt: makeGameTime(1, 3, "early") }),
      heir({ id: "heir_000003", sex: "daughter", birthAt: makeGameTime(1, 1, "early") }),
    ];
    const daughters = listHeirsBySex(heirs, "daughter");
    expect(daughters.map((h) => h.name)).toEqual(["大皇子", "二皇子"]);
    expect(daughters[0]!.heir.id).toBe("heir_000003"); // earliest birth first
    const sons = listHeirsBySex(heirs, "son");
    expect(sons.map((h) => h.name)).toEqual(["大皇郎"]);
  });
});

describe("heirAge", () => {
  it("birth year = 0 岁; later year subtracts", () => {
    expect(heirAge(heir({ birthAt: makeGameTime(1, 5, "early") }), makeGameTime(1, 12, "late"))).toBe(0);
    expect(heirAge(heir({ birthAt: makeGameTime(1, 5, "early") }), makeGameTime(3, 1, "early"))).toBe(2);
  });
});

describe("nextHeirId", () => {
  it("pads to 6 digits from current count", () => {
    expect(nextHeirId(0)).toBe("heir_000001");
    expect(nextHeirId(11)).toBe("heir_000012");
  });
});

describe("heirAgeMonths", () => {
  it("counts whole months by monthOrdinal difference", () => {
    const h = heir({ birthAt: makeGameTime(1, 1, "early") });
    expect(heirAgeMonths(h, makeGameTime(1, 1, "late"))).toBe(0);
    expect(heirAgeMonths(h, makeGameTime(1, 4, "early"))).toBe(3);
    expect(heirAgeMonths(h, makeGameTime(2, 1, "early"))).toBe(12);
  });
});

describe("heirStage", () => {
  it("infant <3y, toddler 3–4y, schooling ≥5y", () => {
    const born = makeGameTime(1, 1, "early");
    expect(heirStage(heir({ birthAt: born }), makeGameTime(3, 1, "early"))).toBe("infant"); // 2 岁
    expect(heirStage(heir({ birthAt: born }), makeGameTime(4, 1, "early"))).toBe("toddler"); // 3 岁
    expect(heirStage(heir({ birthAt: born }), makeGameTime(6, 1, "early"))).toBe("schooling"); // 5 岁
  });
});

describe("centennialDue", () => {
  it("true once ≥3 months old and not yet formally named", () => {
    const born = makeGameTime(1, 1, "early");
    expect(centennialDue(heir({ birthAt: born }), makeGameTime(1, 2, "early"))).toBe(false); // 1 月
    expect(centennialDue(heir({ birthAt: born }), makeGameTime(1, 4, "early"))).toBe(true); // 3 月
    expect(centennialDue(heir({ birthAt: born, givenName: "长安" }), makeGameTime(1, 4, "early"))).toBe(false);
  });
});

describe("isEnrolled", () => {
  it("true at 5 周岁", () => {
    const born = makeGameTime(1, 1, "early");
    expect(isEnrolled(heir({ birthAt: born }), makeGameTime(5, 1, "early"))).toBe(false); // 4 岁
    expect(isEnrolled(heir({ birthAt: born }), makeGameTime(6, 1, "early"))).toBe(true); // 5 岁
  });
});

describe("heirPortraitSet", () => {
  it("baby set under schooling, school set when enrolled", () => {
    const born = makeGameTime(1, 1, "early");
    expect(heirPortraitSet(heir({ birthAt: born }), makeGameTime(2, 1, "early"))).toBe("child_baby");
    expect(heirPortraitSet(heir({ birthAt: born }), makeGameTime(6, 1, "early"))).toBe("child_school");
  });
});
