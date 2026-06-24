import { describe, expect, it } from "vitest";
import {
  buildAnnualExamination,
  examScore,
  getCandidateById,
  getCandidatePoolCount,
  getCandidatesByExaminationYear,
  getEligibleOfficialCandidates,
  getLatestExaminationResult,
  hasGeneratedExaminationForYear,
  settleAnnualExamination,
} from "../../src/engine/officials/examination";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("buildAnnualExamination — determinism & shape", () => {
  it("same seed → identical candidates/result; different seed differs", () => {
    const a = buildAnnualExamination(createNewGameState(db, 5), db, 1, at(1));
    const b = buildAnnualExamination(createNewGameState(db, 5), db, 1, at(1));
    expect(a).toEqual(b);
    const c = buildAnnualExamination(createNewGameState(db, 6), db, 1, at(1));
    expect(c.candidates).not.toEqual(a.candidates);
  });

  it("generates 4–8 candidates with consecutive ranks 1..N, sorted by exam score", () => {
    const { candidates, result } = buildAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const list = Object.values(candidates);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.length).toBeLessThanOrEqual(8);
    const ranks = list.map((c) => c.examinationRank).sort((x, y) => x - y);
    expect(ranks).toEqual(Array.from({ length: list.length }, (_, i) => i + 1));
    // rank order == score-descending order
    const byRank = [...list].sort((x, y) => x.examinationRank - y.examinationRank);
    for (let i = 1; i < byRank.length; i++) {
      expect(examScore(byRank[i - 1]!.aptitude)).toBeGreaterThanOrEqual(examScore(byRank[i]!.aptitude));
    }
    expect(result.candidateIds).toHaveLength(list.length);
    expect(result.acknowledged).toBe(false);
  });

  it("candidates are female-only (no sex field), not officials, eligible, with a 5y window", () => {
    const s = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    for (const c of Object.values(s.officialCandidates)) {
      expect(s.officials[c.id]).toBeUndefined(); // not an official
      expect(c.status).toBe("eligible");
      expect(c.expiresAtYear).toBe(c.examinationYear + 5);
      expect(c.origin).toBe("examination");
    }
  });

  it("family-linked candidates reuse an existing family's surname and add NO kinship edges", () => {
    const base = createNewGameState(db, 1);
    const s = settleAnnualExamination(base, db, 1, at(1));
    expect(s.kinship).toEqual(base.kinship); // 不伪造新亲缘边
    for (const c of Object.values(s.officialCandidates)) {
      if (c.familyId !== null) {
        expect(s.officialFamilies[c.familyId]).toBeDefined();
        expect(c.surname).toBe(s.officialFamilies[c.familyId]!.surname);
      }
    }
  });
});

describe("settleAnnualExamination — idempotent + valid", () => {
  it("generates once per year and is idempotent", () => {
    const s1 = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    expect(hasGeneratedExaminationForYear(s1, 1)).toBe(true);
    const s2 = settleAnnualExamination(s1, db, 1, at(1));
    expect(s2).toBe(s1); // 未变（同引用）
    expect(s1.examinationResults).toHaveLength(1);
  });

  it("new game stays valid through generation + schema", () => {
    const s = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    expect(validateOfficialWorld(s, db)).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});

describe("candidate selectors", () => {
  it("expose pool/year/id/latest queries without consuming RNG", () => {
    let s = createNewGameState(db, 1);
    s = settleAnnualExamination(s, db, 1, at(1));
    s = settleAnnualExamination(s, db, 2, at(2));
    expect(getLatestExaminationResult(s)!.year).toBe(2);
    expect(getCandidatesByExaminationYear(s, 1).every((c) => c.examinationYear === 1)).toBe(true);
    expect(getCandidatesByExaminationYear(s, 1).map((c) => c.examinationRank)).toEqual(
      getCandidatesByExaminationYear(s, 1).map((_, i) => i + 1),
    );
    const first = getCandidatesByExaminationYear(s, 1)[0]!;
    expect(getCandidateById(s, first.id)).toEqual(first);
    expect(getCandidatePoolCount(s)).toBe(getEligibleOfficialCandidates(s).length);
    // 查询不改变 state
    const snap = JSON.stringify(s.officialCandidates);
    getEligibleOfficialCandidates(s); getLatestExaminationResult(s);
    expect(JSON.stringify(s.officialCandidates)).toBe(snap);
  });
});
