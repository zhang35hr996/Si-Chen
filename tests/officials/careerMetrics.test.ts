/** 官员能力与铨选评分（Phase 3 PR3C-1）：确定性能力、家族势力、升迁评分。无职位变化。 */
import { describe, expect, it } from "vitest";
import {
  deriveOfficialAptitude,
  familyBacking,
  gradeWeightFactor,
  initialReviewState,
  promotionScore,
  seniorityScore,
  seniorityYears,
} from "../../src/engine/officials/careerMetrics";
import { appointOfficialCandidate } from "../../src/engine/officials/appointment";
import { settleAnnualExamination, getEligibleOfficialCandidates } from "../../src/engine/officials/examination";
import { getVacantPosts } from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, Official } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("aptitude backfill", () => {
  it("worldgen officials carry deterministic aptitude + initial reviewState", () => {
    const s = createNewGameState(db, 1);
    for (const o of Object.values(s.officials)) {
      expect(o.aptitude).toEqual(deriveOfficialAptitude(o.id, s.rngSeed));
      expect(o.reviewState).toEqual(initialReviewState());
    }
  });

  it("deriveOfficialAptitude is deterministic per (id, seed) and bounded 20..95", () => {
    const a = deriveOfficialAptitude("official_x", 7);
    expect(deriveOfficialAptitude("official_x", 7)).toEqual(a);
    expect(deriveOfficialAptitude("official_x", 8)).not.toEqual(a);
    for (const v of Object.values(a)) { expect(v).toBeGreaterThanOrEqual(20); expect(v).toBeLessThanOrEqual(95); }
  });

  it("candidate appointment inherits the candidate's aptitude verbatim", () => {
    const base = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const c = getEligibleOfficialCandidates(base)[0]!;
    const r = appointOfficialCandidate(base, db, c.id, getVacantPosts(base, db)[0]!.postId, at(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[`official_appointed_${c.id}`]!.aptitude).toEqual(c.aptitude);
    expect(validateOfficialWorld(r.value, db)).toEqual([]);
  });
});

describe("seniority", () => {
  it("counts years in the current post from appointedAt", () => {
    const off = { appointedAt: { year: 3, month: 1, period: "early" as const, dayIndex: 0 } } as Official;
    expect(seniorityYears(off, { year: 8 })).toBe(5);
    expect(seniorityScore(off, { year: 13 })).toBe(100); // 10 年计满
    expect(seniorityYears({} as Official, { year: 5 })).toBe(0); // 无 appointedAt
  });
});

/**
 * 把五项升迁输入全部拉满/清零的可控状态。level=100 给本家族两名顶配侍君（使 consortBacking=100→
 * familyBacking=100）；level=0 清空本家族侍君（consortBacking=0）。
 */
function controlledState(level: 0 | 100): { s: GameState; off: Official } {
  const base = createNewGameState(db, 1);
  const off0 = Object.values(base.officials).find((o) => o.status === "active")!;
  const famId = off0.familyId;
  const off: Official = {
    ...off0,
    loyalty: level,
    aptitude: { governance: level, scholarship: level, military: level, integrity: level },
    reviewState: { merit: level, underperformanceYears: 0 },
    appointedAt: level === 100 ? { year: 1, month: 1, period: "early", dayIndex: 0 } : base.calendar,
  };
  const topRank = Object.values(db.ranks).filter((r) => r.domain === "harem").sort((a, b) => b.order - a.order)[0]!;
  // 先把本家族既有侍君全部移走，确保只剩受控侍君。
  const standing = { ...base.standing };
  for (const id of Object.keys(standing)) {
    if (standing[id]!.birthFamilyId === famId) standing[id] = { ...standing[id]!, birthFamilyId: "fam_cleared_sentinel" };
  }
  if (level === 100) {
    for (const id of Object.keys(base.standing).slice(0, 2)) {
      standing[id] = { ...standing[id]!, birthFamilyId: famId, rank: topRank.id, favor: 100, lifecycle: "normal" };
    }
  }
  const s: GameState = {
    ...base,
    calendar: { ...base.calendar, year: level === 100 ? 50 : base.calendar.year },
    officials: { ...base.officials, [off.id]: off },
    officialFamilies: { ...base.officialFamilies, [famId]: { ...base.officialFamilies[famId]!, influence: level, imperialFavor: level } },
    standing,
  };
  return { s, off };
}

describe("familyBacking", () => {
  it("is 0 for a family with no consorts; rises with influence/favor/consort", () => {
    const base = createNewGameState(db, 1);
    // 找一个无关联侍君的家族壳。
    const lonelyFam = Object.keys(base.officialFamilies).find(
      (f) => !Object.values(base.standing).some((s) => s.birthFamilyId === f),
    );
    if (lonelyFam) {
      const zero = { ...base, officialFamilies: { ...base.officialFamilies, [lonelyFam]: { ...base.officialFamilies[lonelyFam]!, influence: 0, imperialFavor: 0 } } };
      expect(familyBacking(zero, db, lonelyFam)).toBe(0);
    }
    expect(familyBacking(controlledState(100).s, db, controlledState(100).off.familyId)).toBe(100);
    expect(familyBacking(controlledState(0).s, db, controlledState(0).off.familyId)).toBe(0);
  });

  it("only counts the top-2 consorts of the SAME family (no surname guessing)", () => {
    const { s, off } = controlledState(100);
    const base = familyBacking(s, db, off.familyId);
    expect(base).toBe(100); // 本家族两名顶配侍君
    // 一名不同家族的高位侍君加入，不应影响本家族 backing。
    const otherConsort = Object.keys(s.standing).find((id) => s.standing[id]!.birthFamilyId !== off.familyId);
    const tampered = otherConsort
      ? { ...s, standing: { ...s.standing, [otherConsort]: { ...s.standing[otherConsort]!, birthFamilyId: "fam_other_999", rank: s.standing[Object.keys(s.standing)[0]!]!.rank, favor: 100 } } }
      : s;
    expect(familyBacking(tampered, db, off.familyId)).toBe(base);
  });
});

describe("promotionScore — g-weighting & bounds", () => {
  it("all-max inputs → 100 and all-min → 0 at both low and high grade (weights sum to 1)", () => {
    const hi = controlledState(100);
    const lo = controlledState(0);
    for (const gradeOrder of [2, 17]) {
      const post = { department: "chancellery" as const, gradeOrder };
      expect(promotionScore(hi.s, db, hi.off, post)).toBe(100);
      expect(promotionScore(lo.s, db, lo.off, post)).toBe(0);
    }
  });

  it("gradeWeightFactor maps gradeOrder 1→0 and high→1; score deterministic & bounded", () => {
    expect(gradeWeightFactor(1)).toBe(0);
    expect(gradeWeightFactor(18)).toBe(1);
    const s = createNewGameState(db, 1);
    const off = Object.values(s.officials)[0]!;
    const post = { department: "personnel" as const, gradeOrder: 9 };
    const score = promotionScore(s, db, off, post);
    expect(score).toBe(promotionScore(s, db, off, post)); // 确定性
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    const snap = JSON.stringify(s);
    promotionScore(s, db, off, post);
    expect(JSON.stringify(s)).toBe(snap); // 无副作用
  });

  it("seniority weight dominates at low grade; ability/merit/backing dominate at high grade", () => {
    // 年资高、能力低的官员：低品评分应高于高品评分。
    const base = createNewGameState(db, 1);
    const off0 = Object.values(base.officials).find((o) => o.status === "active")!;
    const senior: Official = {
      ...off0,
      aptitude: { governance: 10, scholarship: 10, military: 10, integrity: 10 },
      reviewState: { merit: 10, underperformanceYears: 0 },
      loyalty: 10,
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    };
    const s: GameState = { ...base, calendar: { ...base.calendar, year: 60 }, officials: { ...base.officials, [off0.id]: senior } };
    const low = promotionScore(s, db, senior, { department: "chancellery", gradeOrder: 2 });
    const high = promotionScore(s, db, senior, { department: "chancellery", gradeOrder: 17 });
    expect(low).toBeGreaterThan(high); // 熬年资在高位几乎无用
  });
});
