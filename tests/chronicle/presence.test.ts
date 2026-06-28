import { describe, expect, it } from "vitest";
import { characterExists, isCurrentlyPresent, isDeceased, characterEntryTime } from "../../src/engine/chronicle/presence";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

function heir(over: Partial<Heir>): Heir {
  return {
    id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 2, "early"), favor: 50, legitimate: true, petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 },
    health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20,
    faction: "none", lifecycle: "alive",
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
    interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ...over,
  };
}

describe("presence（皇嗣感知化）", () => {
  it("在世皇嗣：存在、入场=birthAt、出生后在场、未逝", () => {
    const s = createInitialState({ calendar: { month: 8 } }); // now=元年八月
    s.resources.bloodline.heirs.push(heir({}));
    expect(characterExists(s, "heir_000001")).toBe(true);
    expect(characterEntryTime(s, "heir_000001")).toEqual(makeGameTime(1, 2, "early"));
    expect(isCurrentlyPresent(s, "heir_000001")).toBe(true);
    expect(isDeceased(s, "heir_000001")).toBe(false);
  });

  it("夭折皇嗣：仍【存在】（可寻址），但【不在场】且 isDeceased", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.resources.bloodline.heirs.push(heir({ lifecycle: "deceased", deceasedAt: makeGameTime(1, 5, "mid") }));
    expect(characterExists(s, "heir_000001")).toBe(true);   // 死者仍存在
    expect(isDeceased(s, "heir_000001")).toBe(true);
    expect(isCurrentlyPresent(s, "heir_000001")).toBe(false); // 不在场
  });

  it("薨逝侍君：存在、不在场、isDeceased", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["b"] = { rank: "meiren", favor: 50, peakFavor: 50, lifecycle: "deceased", palaceEnteredAt: makeGameTime(1, 1, "early") };
    expect(characterExists(s, "b")).toBe(true);
    expect(isCurrentlyPresent(s, "b")).toBe(false);
    expect(isDeceased(s, "b")).toBe(true);
  });

  it("尚未出生的未来皇嗣：存在但不在场", () => {
    const s = createInitialState(); // now=元年一月
    s.resources.bloodline.heirs.push(heir({ birthAt: makeGameTime(2, 1, "early") }));
    expect(isCurrentlyPresent(s, "heir_000001")).toBe(false);
  });

  it("侍君：仍按 palaceEnteredAt", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["c"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    expect(isCurrentlyPresent(s, "c")).toBe(true);
    expect(characterExists(s, "c")).toBe(true);
  });
});
