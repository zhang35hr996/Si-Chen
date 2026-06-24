/** 候补授官转正引擎（Phase 3 PR3B）。 */
import { describe, expect, it } from "vitest";
import {
  appointOfficialCandidate,
  appointedOfficialId,
  appointmentLoyalty,
  hanmenFamilyId,
} from "../../src/engine/officials/appointment";
import { settleAnnualExamination, getEligibleOfficialCandidates } from "../../src/engine/officials/examination";
import { getVacantPosts } from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, OfficialCandidate } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

function withExam(seed = 1): GameState {
  return settleAnnualExamination(createNewGameState(db, seed), db, 1, at(1));
}
const vacantPostId = (s: GameState) => getVacantPosts(s, db)[0]!.postId;
const candWithFamily = (s: GameState) => getEligibleOfficialCandidates(s).find((c) => c.familyId !== null);
const candHanmen = (s: GameState) => getEligibleOfficialCandidates(s).find((c) => c.familyId === null);

describe("appointOfficialCandidate — success", () => {
  it("creates an active official, marks candidate appointed, writes history provenance", () => {
    const s = withExam();
    const c = getEligibleOfficialCandidates(s)[0]!;
    const postId = vacantPostId(s);
    const r = appointOfficialCandidate(s, db, c.id, postId, at(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const off = r.value.officials[appointedOfficialId(c.id)]!;
    expect(off.status).toBe("active");
    expect(off.postId).toBe(postId);
    expect(off.surname).toBe(c.surname);
    expect(off.givenName).toBe(c.givenName);
    expect(off.age).toBe(c.age);
    expect(off.loyalty).toBe(appointmentLoyalty(c));
    expect(off.appointedAt).toEqual(at(1));
    const nc = r.value.officialCandidates[c.id]!;
    expect(nc.status).toBe("appointed");
    expect(nc.appointedOfficialId).toBe(off.id);
    const h = r.value.officialHistory.at(-1)!;
    expect(h.appointment).toEqual({ candidateId: c.id, examinationYear: c.examinationYear, examinationRank: c.examinationRank, postId, ageAtAppointment: c.age });
    expect(validateOfficialWorld(r.value, db)).toEqual([]);
    // appointed 不再 eligible
    expect(getEligibleOfficialCandidates(r.value).some((x) => x.id === c.id)).toBe(false);
  });

  it("inherits an existing family; hanmen candidate gets a minimal family shell (no members/kinship)", () => {
    let s = withExam();
    const withFam = candWithFamily(s);
    const hanmen = candHanmen(s);
    if (withFam) {
      const r = appointOfficialCandidate(s, db, withFam.id, vacantPostId(s), at(1));
      expect(r.ok && r.value.officials[appointedOfficialId(withFam.id)]!.familyId).toBe(withFam.familyId);
    }
    if (hanmen) {
      const r = appointOfficialCandidate(s, db, hanmen.id, vacantPostId(s), at(1));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const fid = hanmenFamilyId(hanmen.id);
      expect(r.value.officials[appointedOfficialId(hanmen.id)]!.familyId).toBe(fid);
      expect(r.value.officialFamilies[fid]).toBeDefined();
      expect(r.value.officialFamilies[fid]!.surname).toBe(hanmen.surname);
      // 无新增家族成员/亲缘
      expect(Object.values(r.value.familyMembers).some((m) => m.familyId === fid)).toBe(false);
      expect(r.value.kinship).toEqual(s.kinship);
    }
    expect(s).toBe(s); // no-op to keep s referenced
  });
});

describe("appointOfficialCandidate — failure leaves state byte-identical", () => {
  const expectUnchanged = (s: GameState, fn: () => ReturnType<typeof appointOfficialCandidate>, code: string) => {
    const snapshot = JSON.stringify(s);
    const r = fn();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe(code);
    expect(JSON.stringify(s)).toBe(snapshot);
  };

  it("rejects non-existent candidate / post / full seat / non-eligible / double appoint", () => {
    const s = withExam();
    const c = getEligibleOfficialCandidates(s)[0]!;
    expectUnchanged(s, () => appointOfficialCandidate(s, db, "cand_ghost", vacantPostId(s), at(1)), "CANDIDATE_NOT_FOUND");
    expectUnchanged(s, () => appointOfficialCandidate(s, db, c.id, "post_ghost", at(1)), "OFFICIAL_BAD_POST");

    // 占满某官职后再授 → SEAT_FULL（取一个 seatCount=1 且已被占的官职）。
    const fullPost = Object.values(s.officials).find((o) => o.postId && db.officialPosts[o.postId]!.seatCount === 1)!.postId!;
    expectUnchanged(s, () => appointOfficialCandidate(s, db, c.id, fullPost, at(1)), "OFFICIAL_SEAT_FULL");

    // 非 eligible 候补。
    const expired: OfficialCandidate = { ...c, id: "cand_x", status: "expired" };
    const s2 = { ...s, officialCandidates: { ...s.officialCandidates, [expired.id]: expired } };
    expectUnchanged(s2, () => appointOfficialCandidate(s2, db, expired.id, vacantPostId(s2), at(1)), "CANDIDATE_NOT_ELIGIBLE");
  });

  it("rejects a second appointment of the same candidate", () => {
    const s = withExam();
    const c = getEligibleOfficialCandidates(s)[0]!;
    const r1 = appointOfficialCandidate(s, db, c.id, vacantPostId(s), at(1));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = appointOfficialCandidate(r1.value, db, c.id, getVacantPosts(r1.value, db)[0]!.postId, at(1));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("CANDIDATE_NOT_ELIGIBLE");
  });
});

describe("appointmentLoyalty", () => {
  it("is deterministic, integrity-led, bounded 0..100", () => {
    const mk = (integrity: number, governance: number) => ({ aptitude: { integrity, governance, scholarship: 0, military: 0 } });
    expect(appointmentLoyalty(mk(100, 100))).toBe(100);
    expect(appointmentLoyalty(mk(0, 0))).toBe(0);
    expect(appointmentLoyalty(mk(80, 40))).toBe(Math.round(80 * 0.7 + 40 * 0.3));
    expect(appointmentLoyalty(mk(80, 40))).toBe(appointmentLoyalty(mk(80, 40))); // 稳定
  });
});
