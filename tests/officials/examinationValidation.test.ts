/** validateOfficialWorld 对候补池/科举不变量的捕获（Phase 3 PR3A）。 */
import { describe, expect, it } from "vitest";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, OfficialCandidate } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });
const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);

/** 含一届科举的状态 + 该届首名候补 id。 */
function withExam(): { s: GameState; id: string } {
  const s = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
  const id = Object.keys(s.officialCandidates)[0]!;
  return { s, id };
}
const setCand = (s: GameState, id: string, patch: Partial<OfficialCandidate>): GameState => ({
  ...s, officialCandidates: { ...s.officialCandidates, [id]: { ...s.officialCandidates[id]!, ...patch } },
});

describe("candidate / examination invariants", () => {
  it("candidate id colliding with an official → CANDIDATE_IS_OFFICIAL", () => {
    const { s } = withExam();
    const officialId = Object.keys(s.officials)[0]!;
    const bad = { ...s, officialCandidates: { ...s.officialCandidates, [officialId]: { ...Object.values(s.officialCandidates)[0]!, id: officialId } } };
    expect(codes(bad)).toContain("CANDIDATE_IS_OFFICIAL");
  });

  it("record key / id mismatch → CANDIDATE_KEY_MISMATCH", () => {
    const { s, id } = withExam();
    expect(codes(setCand(s, id, { id: "cand_relabelled" }))).toContain("CANDIDATE_KEY_MISMATCH");
  });

  it("illegal age → CANDIDATE_BAD_AGE", () => {
    const { s, id } = withExam();
    expect(codes(setCand(s, id, { age: 200 }))).toContain("CANDIDATE_BAD_AGE");
  });

  it("familyId pointing at no family → CANDIDATE_BAD_FAMILY", () => {
    const { s, id } = withExam();
    expect(codes(setCand(s, id, { familyId: "fam_9999" }))).toContain("CANDIDATE_BAD_FAMILY");
  });

  it("duplicate rank in a year → CANDIDATE_DUP_RANK", () => {
    const { s } = withExam();
    const [a, b] = Object.keys(s.officialCandidates);
    const bad = setCand(setCand(s, a!, { examinationRank: 1 }), b!, { examinationRank: 1 });
    expect(codes(bad)).toContain("CANDIDATE_DUP_RANK");
  });

  it("non-consecutive ranks → CANDIDATE_RANK_GAP", () => {
    const { s } = withExam();
    // 把最后一名的 rank 顶到 N+1，制造缺口。
    const list = Object.values(s.officialCandidates);
    const last = list[list.length - 1]!;
    expect(codes(setCand(s, last.id, { examinationRank: list.length + 1 }))).toContain("CANDIDATE_RANK_GAP");
  });

  it("appointed without a valid appointedOfficialId → CANDIDATE_APPOINTED_NO_OFFICIAL", () => {
    const { s, id } = withExam();
    expect(codes(setCand(s, id, { status: "appointed" }))).toContain("CANDIDATE_APPOINTED_NO_OFFICIAL");
  });

  it("eligible candidate past its expiry → CANDIDATE_EXPIRED_STILL_ELIGIBLE", () => {
    const { s, id } = withExam();
    const future = { ...s, calendar: { ...s.calendar, year: s.officialCandidates[id]!.expiresAtYear } };
    expect(codes(future)).toContain("CANDIDATE_EXPIRED_STILL_ELIGIBLE");
  });

  it("two exam results for one year → EXAM_DUP_YEAR", () => {
    const { s } = withExam();
    const bad = { ...s, examinationResults: [...s.examinationResults, { ...s.examinationResults[0]! }] };
    expect(codes(bad)).toContain("EXAM_DUP_YEAR");
  });

  it("result referencing a missing / wrong-year candidate → EXAM_BAD_CANDIDATE_REF / EXAM_YEAR_MISMATCH", () => {
    const { s } = withExam();
    const ghost = { ...s, examinationResults: [{ ...s.examinationResults[0]!, candidateIds: [...s.examinationResults[0]!.candidateIds, "cand_ghost"] }] };
    expect(codes(ghost)).toContain("EXAM_BAD_CANDIDATE_REF");
    const id = Object.keys(s.officialCandidates)[0]!;
    expect(codes(setCand(s, id, { examinationYear: 99 }))).toContain("EXAM_YEAR_MISMATCH");
  });

  it("a clean generated world has none of these", () => {
    const { s } = withExam();
    expect(validateOfficialWorld(s, db)).toEqual([]);
  });
});
