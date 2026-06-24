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

  it("eligible past expiry by settlement marker → CANDIDATE_EXPIRED_STILL_ELIGIBLE", () => {
    const { s, id } = withExam(); // latestSettledExamYear = 1
    // 把有效期设到 ≤ 已结算年份(1) 却仍 eligible → 非法。
    expect(codes(setCand(s, id, { expiresAtYear: 1 }))).toContain("CANDIDATE_EXPIRED_STILL_ELIGIBLE");
  });

  it("eligible at its expiry YEAR but before that year's settlement is VALID (loadable Jan)", () => {
    const { s, id } = withExam(); // 仅年-1 已结算
    const c = s.officialCandidates[id]!;
    // calendar 推到 expiresAtYear 正月，但该年科举尚未结算（latestSettledExamYear 仍为 1）。
    const jan = { ...s, calendar: { ...s.calendar, year: c.expiresAtYear, month: 1 } };
    expect(codes(jan)).not.toContain("CANDIDATE_EXPIRED_STILL_ELIGIBLE");
  });

  it("two exam results for one year → EXAM_DUP_YEAR", () => {
    const { s } = withExam();
    const bad = { ...s, examinationResults: [...s.examinationResults, { ...s.examinationResults[0]! }] };
    expect(codes(bad)).toContain("EXAM_DUP_YEAR");
  });

  it("canonical 榜单：缺漏/多余/乱序/重复/混荐举/generatedAt 年份均被 EXAM_* 捕获", () => {
    const { s } = withExam();
    const res0 = s.examinationResults[0]!;
    const withRes = (candidateIds: string[]) => ({ ...s, examinationResults: [{ ...res0, candidateIds }] });
    // 含不存在的候补（与 canonical 不等）。
    expect(codes(withRes([...res0.candidateIds, "cand_ghost"]))).toContain("EXAM_CANDIDATE_LIST_MISMATCH");
    // 重复 id。
    expect(codes(withRes([res0.candidateIds[0]!, res0.candidateIds[0]!]))).toContain("EXAM_CANDIDATE_LIST_MISMATCH");
    // 顺序与榜次不符（首尾互换）。
    const swapped = [...res0.candidateIds]; [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(codes(withRes(swapped))).toContain("EXAM_CANDIDATE_LIST_MISMATCH");
    // generatedAt 年份不符。
    const badGen = { ...s, examinationResults: [{ ...res0, generatedAt: { ...res0.generatedAt, year: 99 } }] };
    expect(codes(badGen)).toContain("EXAM_GENERATED_YEAR_MISMATCH");
    // 候补年份被改 → 该年 canonical 序列与榜单不符。
    const id = res0.candidateIds[0]!;
    expect(codes(setCand(s, id, { examinationYear: 99 }))).toContain("EXAM_CANDIDATE_LIST_MISMATCH");
  });

  it("混入 origin=recommendation 的候补不得进榜单（canonical 仅含 examination）", () => {
    const { s } = withExam();
    const id = s.examinationResults[0]!.candidateIds[0]!;
    // 把榜上一人改为荐举来源 → canonical 期望不含它 → 不一致。
    expect(codes(setCand(s, id, { origin: "recommendation" }))).toContain("EXAM_CANDIDATE_LIST_MISMATCH");
  });

  it("a clean generated world has none of these", () => {
    const { s } = withExam();
    expect(validateOfficialWorld(s, db)).toEqual([]);
  });
});
