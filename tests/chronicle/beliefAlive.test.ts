import { describe, expect, it } from "vitest";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

function heir(over: Partial<Heir>): Heir {
  return {
    id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: true, petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 },
    health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20,
    faction: "none", lifecycle: "alive",
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
    interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ...over,
  };
}

describe("alive 谓词（belief）", () => {
  it("侍君：在世 true，薨逝(deceased) → false（非 undefined）", () => {
    const s = createInitialState();
    s.standing["viewer"] = { rank: "meiren", favor: 50, peakFavor: 50 };
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50 };
    s.standing["b"] = { rank: "meiren", favor: 50, peakFavor: 50, lifecycle: "deceased" };
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "a" })).toEqual({ value: true, certainty: 100 });
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "b" })).toEqual({ value: false, certainty: 100 });
  });

  it("皇嗣：在世 alive=true；夭折 alive=false（可查死者，非 undefined）", () => {
    const s = createInitialState();
    s.standing["viewer"] = { rank: "meiren", favor: 50, peakFavor: 50 };
    s.resources.bloodline.heirs.push(heir({}));                                   // 在世
    s.resources.bloodline.heirs.push(heir({ id: "heir_000002", lifecycle: "deceased", deceasedAt: makeGameTime(1, 5, "mid") }));
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "heir_000001" })).toEqual({ value: true, certainty: 100 });
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "heir_000002" })).toEqual({ value: false, certainty: 100 });
  });

  it("现状类谓词（resides_at）查死者 → undefined（死者不在场）", () => {
    const s = createInitialState();
    s.standing["viewer"] = { rank: "meiren", favor: 50, peakFavor: 50 };
    s.standing["b"] = { rank: "meiren", favor: 50, peakFavor: 50, residence: "x", lifecycle: "deceased" };
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "resides_at", subjectId: "b" })).toBeUndefined();
  });

  it("已逝 viewer 查 alive → undefined（viewer 须在场）", () => {
    const s = createInitialState();
    s.standing["deadViewer"] = { rank: "meiren", favor: 50, peakFavor: 50, lifecycle: "deceased" };
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50 };
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("deadViewer", { predicate: "alive", subjectId: "a" })).toBeUndefined();
  });
});
