import { describe, expect, it } from "vitest";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

function stateWithCourt() {
  const s = createInitialState();
  s.standing["viewer"] = { rank: "meiren", favor: 50, peakFavor: 50 };
  s.standing["consort_gu"] = { rank: "meiren", favor: 50, peakFavor: 50, residence: "xianfu_palace" };
  return s;
}

describe("GroundTruthBeliefProjection (v1, 非全知)", () => {
  it("朝廷成员可见他人当前位分/住处（certainty 100）", () => {
    const bp = new GroundTruthBeliefProjection(stateWithCourt());
    expect(bp.getFact("viewer", { predicate: "holds_rank", subjectId: "consort_gu" }))
      .toEqual({ value: "meiren", certainty: 100 });
    expect(bp.getFact("viewer", { predicate: "resides_at", subjectId: "consort_gu" }))
      .toEqual({ value: "xianfu_palace", certainty: 100 });
  });

  it("未知 viewer（无 standing）→ undefined（非全知）", () => {
    const bp = new GroundTruthBeliefProjection(stateWithCourt());
    expect(bp.getFact("ghost", { predicate: "holds_rank", subjectId: "consort_gu" })).toBeUndefined();
  });

  it("未知 subject → undefined", () => {
    const bp = new GroundTruthBeliefProjection(stateWithCourt());
    expect(bp.getFact("viewer", { predicate: "holds_rank", subjectId: "nobody" })).toBeUndefined();
  });

  it("subject 无 residence → resides_at undefined", () => {
    const s = stateWithCourt();
    delete s.standing["consort_gu"]!.residence;
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "resides_at", subjectId: "consort_gu" })).toBeUndefined();
  });

  it("尚未入宫的未来 viewer / subject → undefined（非在场不可见）", () => {
    const s = stateWithCourt(); // now = 元年一月
    s.standing["future_viewer"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(2, 1, "early") };
    s.standing["future_subject"] = { rank: "meiren", favor: 50, peakFavor: 50, residence: "x", palaceEnteredAt: makeGameTime(2, 1, "early") };
    const bp = new GroundTruthBeliefProjection(s);
    // 未来 viewer 看不到现任
    expect(bp.getFact("future_viewer", { predicate: "holds_rank", subjectId: "consort_gu" })).toBeUndefined();
    // 在场者也看不到尚未入宫的未来 subject
    expect(bp.getFact("viewer", { predicate: "holds_rank", subjectId: "future_subject" })).toBeUndefined();
  });
});
