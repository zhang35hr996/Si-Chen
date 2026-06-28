import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import {
  heirName, heirAge, nextHeirId, listHeirsBySex,
  heirAgeMonths, heirStage, centennialDue, isEnrolled, heirPortraitSet,
  isWenzhaoStudent, isWenzhaodianOpen,
} from "../../src/engine/characters/heirs";
import { createCalendar } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

const defaultPersonality = { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 };
const defaultPortraitVariants = { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" };

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001",
  sex: "daughter",
  fatherId: null,
  bearer: "sovereign",
  birthAt: makeGameTime(1, 5, "early"),
  favor: 50,
  legitimate: true,
  petName: "",
  education: { scholarship: 5, martial: 5, virtue: 5 },
  health: 60, talent: 50, diligence: 50,
  personality: defaultPersonality,
  interests: [],
  imperialFear: 20,
  neglect: 40,
  custodianBond: 0,
  portraitVariants: defaultPortraitVariants,
  ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
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
  it("皇子（女）5 岁开蒙", () => {
    const born = makeGameTime(1, 1, "early");
    expect(isEnrolled(heir({ birthAt: born, sex: "daughter" }), makeGameTime(5, 1, "early"))).toBe(false); // 4 岁
    expect(isEnrolled(heir({ birthAt: born, sex: "daughter" }), makeGameTime(6, 1, "early"))).toBe(true); // 5 岁
  });

  it("皇郎（男）7 岁开蒙", () => {
    const born = makeGameTime(1, 1, "early");
    const sonVariants = { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" };
    expect(isEnrolled(heir({ birthAt: born, sex: "son", portraitVariants: sonVariants }), makeGameTime(7, 1, "early"))).toBe(false); // 6 岁
    expect(isEnrolled(heir({ birthAt: born, sex: "son", portraitVariants: sonVariants }), makeGameTime(8, 1, "early"))).toBe(true); // 7 岁
  });
});

describe("heirPortraitSet", () => {
  it("returns portraitVariants key matching appearance stage", () => {
    const born = makeGameTime(1, 1, "early");
    const variants = { baby: "girl_baby1", kid: "girl_kid2", child: "girl_child3", teen: "girl_teen4" };
    const h = heir({ birthAt: born, portraitVariants: variants });
    expect(heirPortraitSet(h, makeGameTime(1, 1, "early"))).toBe("girl_baby1"); // 0 岁→baby
    expect(heirPortraitSet(h, makeGameTime(2, 1, "early"))).toBe("girl_kid2");  // 1 岁→kid
    expect(heirPortraitSet(h, makeGameTime(9, 1, "early"))).toBe("girl_child3"); // 8 岁→child
    expect(heirPortraitSet(h, makeGameTime(13, 1, "early"))).toBe("girl_teen4"); // 12 岁→teen
    expect(heirPortraitSet(h, makeGameTime(19, 1, "early"))).toBe("girl_teen4"); // 18 岁→adult→falls back to teen
  });
});

describe("isWenzhaoStudent", () => {
  const schoolingHeir = (over: Partial<ReturnType<typeof heir>> = {}) =>
    heir({ birthAt: makeGameTime(1, 1, "early"), sex: "daughter", ...over });

  it("returns true for alive enrolled daughter at year 6 (age 5)", () => {
    const h = schoolingHeir({ lifecycle: "alive" });
    expect(isWenzhaoStudent(h, makeGameTime(6, 1, "early"))).toBe(true);
  });

  it("returns false for deceased enrolled daughter", () => {
    const h = schoolingHeir({ lifecycle: "deceased" });
    expect(isWenzhaoStudent(h, makeGameTime(6, 1, "early"))).toBe(false);
  });

  it("returns false for alive daughter not yet enrolled (age 4)", () => {
    const h = schoolingHeir({ lifecycle: "alive" });
    expect(isWenzhaoStudent(h, makeGameTime(5, 1, "early"))).toBe(false);
  });

  it("returns false for alive son at age 5 (son opens at 7)", () => {
    const h = schoolingHeir({ lifecycle: "alive", sex: "son" });
    expect(isWenzhaoStudent(h, makeGameTime(6, 1, "early"))).toBe(false);
  });

  it("returns true for alive son at age 7", () => {
    const h = schoolingHeir({ lifecycle: "alive", sex: "son" });
    expect(isWenzhaoStudent(h, makeGameTime(8, 1, "early"))).toBe(true);
  });

  it("returns true for alive son at age 17", () => {
    const h = schoolingHeir({ lifecycle: "alive", sex: "son" });
    expect(isWenzhaoStudent(h, makeGameTime(18, 1, "early"))).toBe(true);
  });

  it("returns false for alive son at age 18 (离校)", () => {
    const h = schoolingHeir({ lifecycle: "alive", sex: "son" });
    expect(isWenzhaoStudent(h, makeGameTime(19, 1, "early"))).toBe(false);
  });

  it("returns true for alive daughter at age 18 (无上限)", () => {
    const h = schoolingHeir({ lifecycle: "alive", sex: "daughter" });
    expect(isWenzhaoStudent(h, makeGameTime(19, 1, "early"))).toBe(true);
  });
});

describe("isWenzhaodianOpen", () => {
  it("returns true at full AP — slot 0 (卯时 = day)", () => {
    const cal = createCalendar(); // ap=apMax=5, slot=0 → 卯时 → day
    expect(isWenzhaodianOpen(cal)).toBe(true);
  });

  it("returns true at ap=4 — slot 1 (辰时 = day)", () => {
    expect(isWenzhaodianOpen({ ...createCalendar(), ap: 4 })).toBe(true);
  });

  it("returns true at ap=3 — slot 2 (申时 = day)", () => {
    expect(isWenzhaodianOpen({ ...createCalendar(), ap: 3 })).toBe(true);
  });

  it("returns false at ap=2 — slot 3 (酉时 = twilight)", () => {
    expect(isWenzhaodianOpen({ ...createCalendar(), ap: 2 })).toBe(false);
  });

  it("returns false at ap=1 — slot 4 (戌时 = night)", () => {
    expect(isWenzhaodianOpen({ ...createCalendar(), ap: 1 })).toBe(false);
  });
});
