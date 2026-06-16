import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { heirName, heirAge, nextHeirId, listHeirsBySex } from "../../src/engine/characters/heirs";
import type { Heir } from "../../src/engine/state/types";

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001",
  sex: "daughter",
  fatherId: null,
  bearer: "sovereign",
  birthAt: makeGameTime(1, 5, "early"),
  favor: 50,
  legitimate: true,
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
