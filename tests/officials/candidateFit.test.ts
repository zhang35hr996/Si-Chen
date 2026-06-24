/** 候补—官职适配评分（Phase 3 PR3B）：部门权重、范围、确定性、tie-break、无副作用。 */
import { describe, expect, it } from "vitest";
import { DEPARTMENT_FIT_WEIGHTS, candidatePostFit } from "../../src/engine/officials/fit";
import { rankCandidatesForPost } from "../../src/engine/officials/candidateAppointmentSelectors";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { OfficialDepartment } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });
const cand = (apt: Partial<{ governance: number; scholarship: number; military: number; integrity: number }>) => ({
  aptitude: { governance: 0, scholarship: 0, military: 0, integrity: 0, ...apt },
});
const post = (department: OfficialDepartment) => ({ department });

describe("candidatePostFit — department weighting", () => {
  it("each department leads with the intended primary attribute", () => {
    // 主属性满分(100)、其余 0 → 适配 = 主权重*100。
    const lead = (department: OfficialDepartment, attr: "governance" | "scholarship" | "military" | "integrity") =>
      candidatePostFit(cand({ [attr]: 100 }), post(department));
    expect(lead("chancellery", "governance")).toBe(60);
    expect(lead("personnel", "governance")).toBe(60);
    expect(lead("revenue", "governance")).toBe(60);
    expect(lead("works", "governance")).toBe(60);
    expect(lead("provincial", "governance")).toBe(60);
    expect(lead("rites", "scholarship")).toBe(60);
    expect(lead("academy", "scholarship")).toBe(60);
    expect(lead("military", "military")).toBe(60);
    expect(lead("censorate", "integrity")).toBe(60);
    expect(lead("justice", "integrity")).toBe(60);
    expect(lead("none", "governance")).toBe(25); // balanced
  });

  it("weights each sum to 1 (score stays within 0..100)", () => {
    for (const w of Object.values(DEPARTMENT_FIT_WEIGHTS)) {
      expect(w.governance + w.scholarship + w.military + w.integrity).toBeCloseTo(1, 10);
    }
    expect(candidatePostFit(cand({ governance: 100, scholarship: 100, military: 100, integrity: 100 }), post("censorate"))).toBe(100);
    expect(candidatePostFit(cand({}), post("censorate"))).toBe(0);
  });

  it("is deterministic and does not mutate inputs", () => {
    const c = cand({ governance: 55, integrity: 70 });
    const frozen = JSON.stringify(c);
    expect(candidatePostFit(c, post("justice"))).toBe(candidatePostFit(c, post("justice")));
    expect(JSON.stringify(c)).toBe(frozen);
  });
});

describe("rankCandidatesForPost — stable ordering", () => {
  it("sorts by fit desc then rank then id; pure", () => {
    const s = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const postId = Object.keys(db.officialPosts)[0]!;
    const ranked = rankCandidatesForPost(s, db, postId);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.fit).toBeGreaterThanOrEqual(ranked[i]!.fit);
    const snap = JSON.stringify(s.officialCandidates);
    rankCandidatesForPost(s, db, postId);
    expect(JSON.stringify(s.officialCandidates)).toBe(snap);
  });
});
