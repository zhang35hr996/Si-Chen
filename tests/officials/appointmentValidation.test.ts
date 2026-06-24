/** validateOfficialWorld 对授官一致性的捕获（Phase 3 PR3B）。 */
import { describe, expect, it } from "vitest";
import { appointOfficialCandidate, appointedOfficialId } from "../../src/engine/officials/appointment";
import { settleAnnualExamination, getEligibleOfficialCandidates } from "../../src/engine/officials/examination";
import { getVacantPosts } from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });
const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);

/** 已授官一名候补的世界 + 该候补 id。 */
function appointed(): { s: GameState; candidateId: string; officialId: string } {
  const base = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
  const c = getEligibleOfficialCandidates(base)[0]!;
  const r = appointOfficialCandidate(base, db, c.id, getVacantPosts(base, db)[0]!.postId, at(1));
  if (!r.ok) throw new Error("setup appoint failed");
  return { s: r.value, candidateId: c.id, officialId: appointedOfficialId(c.id) };
}

describe("appointment consistency invariants", () => {
  it("a clean appointed world validates", () => {
    expect(validateOfficialWorld(appointed().s, db)).toEqual([]);
  });

  it("name/age inheritance mismatch → CANDIDATE_OFFICIAL_INHERIT_MISMATCH", () => {
    const { s, officialId } = appointed();
    const bad = { ...s, officials: { ...s.officials, [officialId]: { ...s.officials[officialId]!, age: s.officials[officialId]!.age + 5 } } };
    expect(codes(bad)).toContain("CANDIDATE_OFFICIAL_INHERIT_MISMATCH");
  });

  it("family mismatch → CANDIDATE_OFFICIAL_FAMILY_MISMATCH", () => {
    const { s, officialId } = appointed();
    const someFam = Object.keys(s.officialFamilies).find((f) => f !== s.officials[officialId]!.familyId)!;
    const bad = { ...s, officials: { ...s.officials, [officialId]: { ...s.officials[officialId]!, familyId: someFam } } };
    expect(codes(bad)).toContain("CANDIDATE_OFFICIAL_FAMILY_MISMATCH");
  });

  it("two candidates pointing at one official → CANDIDATE_OFFICIAL_DOUBLE_CLAIM", () => {
    const { s, candidateId, officialId } = appointed();
    const c = s.officialCandidates[candidateId]!;
    const clone = { ...c, id: "cand_clone", status: "appointed" as const, appointedOfficialId: officialId };
    const bad = { ...s, officialCandidates: { ...s.officialCandidates, [clone.id]: clone } };
    expect(codes(bad)).toContain("CANDIDATE_OFFICIAL_DOUBLE_CLAIM");
  });

  it("history appointment provenance inconsistent with candidate → HISTORY_APPOINTMENT_INCONSISTENT", () => {
    const { s } = appointed();
    const idx = s.officialHistory.findIndex((h) => h.appointment);
    const h = s.officialHistory[idx]!;
    const tampered = s.officialHistory.slice();
    tampered[idx] = { ...h, appointment: { ...h.appointment!, examinationRank: h.appointment!.examinationRank + 9 } };
    expect(codes({ ...s, officialHistory: tampered })).toContain("HISTORY_APPOINTMENT_INCONSISTENT");
  });

  it("appointed candidate with no backing official → CANDIDATE_APPOINTED_NO_OFFICIAL", () => {
    const { s, officialId } = appointed();
    const rest = { ...s.officials }; delete rest[officialId];
    expect(codes({ ...s, officials: rest })).toContain("CANDIDATE_APPOINTED_NO_OFFICIAL");
  });
});
