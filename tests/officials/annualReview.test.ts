/** 年度吏部考课与自动补缺（Phase 3 PR3C-2）。 */
import { describe, expect, it } from "vitest";
import {
  annualMeritDelta,
  applyDemotions,
  bestFiller,
  buildAnnualReview,
  getLatestAnnualReview,
  hasReviewedYear,
  resolveOfficialVacancies,
  updateMerit,
} from "../../src/engine/officials/annualReview";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, Official } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 11, period: "early" as const, dayIndex: 0 });
const examAt = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });
const withExam = (seed: number, year = 1) => settleAnnualExamination(createNewGameState(db, seed), db, year, examAt(year));
const occupancy = (s: GameState) => {
  const m = new Map<string, number>();
  for (const o of Object.values(s.officials)) if (o.postId) m.set(o.postId, (m.get(o.postId) ?? 0) + 1);
  return m;
};
const noOverSeat = (s: GameState) => [...occupancy(s)].every(([pid, n]) => n <= db.officialPosts[pid]!.seatCount);

describe("merit update", () => {
  it("annualMeritDelta is deterministic and bounded -3..+3; fit-biased", () => {
    const o = { id: "official_x" } as Official;
    expect(annualMeritDelta(o, 90, 3)).toBe(annualMeritDelta(o, 90, 3));
    for (const fit of [0, 30, 50, 70, 100]) {
      const d = annualMeritDelta(o, fit, 5);
      expect(d).toBeGreaterThanOrEqual(-3);
      expect(d).toBeLessThanOrEqual(3);
    }
    expect(annualMeritDelta(o, 100, 3)).toBeGreaterThan(annualMeritDelta(o, 0, 3)); // 适配高者更上行
  });

  it("updateMerit sets lastReviewedYear and tracks consecutive underperformance", () => {
    const base = createNewGameState(db, 1);
    const id = Object.values(base.officials).find((o) => o.status === "active" && o.postId)!.id;
    // 政绩极低 → 必不合格 → underperformanceYears+1。
    const low = { ...base, officials: { ...base.officials, [id]: { ...base.officials[id]!, reviewState: { merit: 1, underperformanceYears: 0 } } } };
    const r = updateMerit(low, db, 7);
    expect(r.officials[id]!.reviewState.lastReviewedYear).toBe(7);
    expect(r.officials[id]!.reviewState.underperformanceYears).toBe(1);
    // 高政绩+好适配 → 合格 → 清零。
    const high = { ...base, officials: { ...base.officials, [id]: { ...base.officials[id]!, reviewState: { merit: 100, underperformanceYears: 3 } } } };
    expect(updateMerit(high, db, 7).officials[id]!.reviewState.underperformanceYears).toBe(0);
  });
});

describe("auto demotion — system_review, never PUNISH", () => {
  it("demotes a 2-year underperformer to a lower grade (or no-post), resets the counter, authority system_review", () => {
    const base = createNewGameState(db, 1);
    const seated = Object.values(base.officials).find((o) => o.status === "active" && o.postId && db.officialPosts[o.postId]!.gradeOrder >= 10)!;
    const fromGrade = db.officialPosts[seated.postId!]!.gradeOrder;
    const s = { ...base, officials: { ...base.officials, [seated.id]: { ...seated, reviewState: { merit: 10, underperformanceYears: 2 } } } };
    const { state, changes } = applyDemotions(s, db, at(3));
    const off = state.officials[seated.id]!;
    const newGrade = off.postId ? db.officialPosts[off.postId]!.gradeOrder : 0;
    expect(newGrade).toBeLessThan(fromGrade); // 降级
    expect(off.reviewState.underperformanceYears).toBe(0); // 计数清零
    expect(changes.some((c) => c.officialId === seated.id && c.kind === "demotion" && c.authority === "system_review")).toBe(true);
    // 不产生任何惩罚记录、不写 punishmentId / reason。
    expect(Object.keys(state.justice.punishments)).toHaveLength(0);
    expect(state.officialHistory.every((h) => h.reason === undefined || h.officialId !== seated.id || h.status === "active")).toBe(true);
  });

  it("a single underperformance year does NOT demote", () => {
    const base = createNewGameState(db, 1);
    const seated = Object.values(base.officials).find((o) => o.status === "active" && o.postId)!;
    const s = { ...base, officials: { ...base.officials, [seated.id]: { ...seated, reviewState: { merit: 10, underperformanceYears: 1 } } } };
    expect(applyDemotions(s, db, at(3)).changes).toHaveLength(0);
  });
});

describe("resolveOfficialVacancies — chain fill", () => {
  it("fills low vacancies from the candidate pool without over-seating; deterministic; writes history", () => {
    const s = withExam(1);
    const before = s.officialHistory.length;
    const a = resolveOfficialVacancies(s, db, at(1));
    const b = resolveOfficialVacancies(s, db, at(1));
    expect(JSON.stringify(a.state.officials)).toBe(JSON.stringify(b.state.officials)); // 确定性
    expect(noOverSeat(a.state)).toBe(true);
    expect(a.changes.length).toBeGreaterThan(0);
    // 每次移动写一条 officialHistory（授官经 appointment 溯源条目）。
    expect(a.state.officialHistory.length).toBeGreaterThan(before);
    expect(validateOfficialWorld(a.state, db)).toEqual([]);
  });

  it("promotes a strong seated official into a higher vacancy, capped at +2 gradeOrder", () => {
    const base = createNewGameState(db, 1);
    // 把一名在任官员坐到 g4 空缺(xunjian)、并拉满其铨选输入，使其满足升迁门槛。
    const o = Object.values(base.officials).find((x) => x.status === "active" && x.postId)!;
    const fromGrade = db.officialPosts.xunjian!.gradeOrder; // 4
    const strong: Official = {
      ...o,
      postId: "xunjian",
      loyalty: 100,
      aptitude: { governance: 100, scholarship: 100, military: 100, integrity: 100 },
      reviewState: { merit: 100, underperformanceYears: 0 },
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    };
    const fam = base.officialFamilies[o.familyId]!;
    const s: GameState = {
      ...base,
      calendar: { ...base.calendar, year: 30 },
      officials: { ...base.officials, [o.id]: strong },
      officialFamilies: { ...base.officialFamilies, [o.familyId]: { ...fam, influence: 100, imperialFavor: 100 } },
    };
    const { state, changes } = resolveOfficialVacancies(s, db, at(30));
    const promo = changes.find((c) => c.officialId === o.id && c.kind === "promotion");
    expect(promo).toBeDefined();
    const newGrade = db.officialPosts[state.officials[o.id]!.postId!]!.gradeOrder;
    expect(newGrade).toBeGreaterThan(fromGrade);
    expect(newGrade).toBeLessThanOrEqual(fromGrade + 2); // 不超 +2
    expect(noOverSeat(state)).toBe(true);
  });
});

/** 用占位在任官员占满给定官职（使其非空缺）。 */
function seatDummies(base: GameState, postIds: string[]): GameState {
  const famId = Object.keys(base.officialFamilies)[0]!;
  const officials = { ...base.officials };
  postIds.forEach((pid, i) => {
    const id = `official_dummy_${i}`;
    officials[id] = {
      id, surname: "占", givenName: `位${i}`, postId: pid, loyalty: 50, age: 40, familyId: famId, status: "active",
      aptitude: { governance: 50, scholarship: 50, military: 50, integrity: 50 }, reviewState: { merit: 50, underperformanceYears: 0 },
      appointedAt: base.calendar,
    };
  });
  return { ...base, officials };
}

describe("PR3C-2 review fixes", () => {
  it("P1: a demoted-to-no-post official is NOT refilled in the same review transaction", () => {
    let base = withExam(1);
    const T = Object.values(base.officials).find((o) => o.status === "active" && o.postId)!;
    // 把 T 坐到 zhubo(g2)、连年不合格；占满 g1(dianshi) 使降级窗口无空缺 → 应降为无职。
    base = seatDummies(base, ["dianshi"]);
    base = { ...base, officials: { ...base.officials, [T.id]: { ...T, postId: "zhubo", reviewState: { merit: 10, underperformanceYears: 2 } } } };
    const r = buildAnnualReview(base, db, 1, at(1));
    expect(r.officials[T.id]!.postId).toBeNull(); // 本轮仍无职，未被补回
    expect(getLatestAnnualReview(r)!.changes.some((c) => c.officialId === T.id && c.kind === "demotion")).toBe(true);
  });

  it("P1: fill priority is strictly no-post → promotable → candidate (no cross-class score)", () => {
    const examined = withExam(1);
    const fam = Object.values(examined.officials)[0]!.familyId;
    const strongPromo = (id: string, postId: string): Official => ({
      id, surname: "升", givenName: id, postId, loyalty: 100, age: 40, familyId: fam, status: "active",
      aptitude: { governance: 100, scholarship: 100, military: 100, integrity: 100 }, reviewState: { merit: 100, underperformanceYears: 0 },
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    });
    const noPostOfficial: Official = { ...strongPromo("official_nopost", "dianshi"), postId: null };
    const zhubo = db.officialPosts.zhubo!;
    const calY = { ...examined, calendar: { ...examined.calendar, year: 30 } };

    // ② 仅可升迁官员 + 候补 → 选官员（promotion）。
    const s2 = { ...calY, officials: { ...calY.officials, official_promo: strongPromo("official_promo", "dianshi") } };
    expect(bestFiller(s2, db, zhubo, new Set())!.kind).toBe("promotion");

    // ① 同时有无职官员 + 可升迁官员 → 选无职（fill），不比分数。
    const s1 = { ...s2, officials: { ...s2.officials, official_nopost: noPostOfficial } };
    expect(bestFiller(s1, db, zhubo, new Set())!.kind).toBe("fill");

    // ③ 既无无职亦无可升迁（authored 官员都高品、不能下迁）→ 候补。
    expect(bestFiller(calY, db, zhubo, new Set())!.kind).toBe("appointment");
  });

  it("P2: demotion never drops more than 2 grades — far-only vacancy → no-post", () => {
    let base = createNewGameState(db, 1);
    // 占满全部 g13/g14（g15 的降级窗口）空缺。
    const windowPosts = Object.values(db.officialPosts).filter((p) => p.gradeOrder === 13 || p.gradeOrder === 14).map((p) => p.id);
    base = seatDummies(base, windowPosts);
    // 用一名全新合成官员坐 g15（libu_shangshu，开局空缺），避免占用 T 移动腾出窗口内空位。
    const famId = Object.keys(base.officialFamilies)[0]!;
    const T: Official = {
      id: "official_target_g15", surname: "考", givenName: "课", postId: "libu_shangshu", loyalty: 50, age: 50, familyId: famId, status: "active",
      aptitude: { governance: 50, scholarship: 50, military: 50, integrity: 50 }, reviewState: { merit: 10, underperformanceYears: 2 }, appointedAt: base.calendar,
    };
    base = { ...base, officials: { ...base.officials, [T.id]: T } };
    const { state } = applyDemotions(base, db, at(3));
    expect(state.officials[T.id]!.postId).toBeNull(); // 无职，绝不一次跌到远低品
  });

  it("P2: a no-post active official is NOT scored as underperforming", () => {
    const base = createNewGameState(db, 1);
    const T = Object.values(base.officials).find((o) => o.status === "active" && o.postId)!;
    const noPost = { ...base, officials: { ...base.officials, [T.id]: { ...T, postId: null, reviewState: { merit: 50, underperformanceYears: 0 } } } };
    const r = updateMerit(noPost, db, 9);
    expect(r.officials[T.id]!.reviewState).toEqual({ merit: 50, underperformanceYears: 0 }); // 完全不变
  });
});

describe("annualReviews validation (PR3C-2)", () => {
  const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);
  const rec = (changes: GameState["annualReviews"][number]["changes"], year = 3) =>
    ({ ...createNewGameState(db, 1), annualReviews: [{ year, at: { year, month: 11, period: "early" as const, dayIndex: 0 }, changes }] }) as GameState;

  it("dup year / at-year mismatch / bad post / bad change / bad direction are caught", () => {
    const ok = rec([{ officialId: "x", kind: "promotion", fromPostId: "zhubo", toPostId: "boshi", authority: "system_review" }]);
    expect(codes(ok)).not.toContain("REVIEW_BAD_DIRECTION");
    expect(codes({ ...ok, annualReviews: [ok.annualReviews[0]!, ok.annualReviews[0]!] })).toContain("REVIEW_DUP_YEAR");
    expect(codes({ ...ok, annualReviews: [{ ...ok.annualReviews[0]!, at: { year: 99, month: 11, period: "early", dayIndex: 0 } }] })).toContain("REVIEW_AT_YEAR_MISMATCH");
    expect(codes(rec([{ officialId: "x", kind: "fill", fromPostId: null, toPostId: "ghost", authority: "system_review" }]))).toContain("REVIEW_BAD_POST");
    expect(codes(rec([{ officialId: "x", kind: "appointment", fromPostId: null, toPostId: "zhubo", authority: "system_review" }]))).toContain("REVIEW_BAD_CHANGE"); // 缺 candidateId
    expect(codes(rec([{ officialId: "x", kind: "promotion", fromPostId: "boshi", toPostId: "zhubo", authority: "system_review" }]))).toContain("REVIEW_BAD_DIRECTION"); // 升迁却降品
  });
});

describe("buildAnnualReview — idempotent, valid, briefing", () => {
  it("runs once per year and records a read-only briefing; world valid; no punishments", () => {
    const s = withExam(2);
    const r = buildAnnualReview(s, db, 1, at(1));
    expect(hasReviewedYear(r, 1)).toBe(true);
    expect(buildAnnualReview(r, db, 1, at(1))).toBe(r); // 幂等（同引用）
    const review = getLatestAnnualReview(r)!;
    expect(review.year).toBe(1);
    expect(review.changes.every((c) => c.authority === "system_review")).toBe(true);
    expect(Object.keys(r.justice.punishments)).toHaveLength(0); // 绝不进 PUNISH
    expect(validateOfficialWorld(r, db)).toEqual([]);
    expect(noOverSeat(r)).toBe(true);
  });
});
