/**
 * 六宫年度例核测试（AR 系列）
 *
 * 覆盖：isHaremAdminReviewWindow / hasHaremAdminReviewForYear /
 *        oldestPendingHaremAdminReport / settleAnnualHaremAdminReview /
 *        GameStore.acknowledgeHaremAdminReview / advanceTime 集成 /
 *        save migration v29 round-trip。
 *
 * 使用「孤立 fixture」：wenya 置于常在（changzai, 84），
 * xu_qinghuan（驸 176）与 lu_huaijin（承徽 156）高于贵人 → wenya 是唯一候选。
 */
import { describe, expect, it } from "vitest";
import {
  isHaremAdminReviewWindow,
  hasHaremAdminReviewForYear,
  oldestPendingHaremAdminReport,
  settleAnnualHaremAdminReview,
  buildHaremAdminReviewLine,
} from "../../src/store/haremAdminAnnualReview";
import { GameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime, dayIndexOf } from "../../src/engine/calendar/time";
import type { CalendarState } from "../../src/engine/calendar/time";
import type { GameState, HaremAdminReviewRecord } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";
import {
  SAVE_FORMAT_VERSION,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { HOUSEHOLD_DEFAULTS, PERSONALITY_DEFAULTS } from "../../src/engine/characters/consortAttrs";

const db = loadRealContent();

// ─── 工具 ────────────────────────────────────────────────────────────────────

function cal(month: number, period: "early" | "mid" | "late", year = 1): CalendarState {
  const gt = makeGameTime(year, month, period);
  return {
    ...gt,
    ap: 5,
    apMax: 5,
    eraName: "",
  };
}

function wenyaFixture(opts: {
  favor?: number;
  loyalty?: number;
  servantOpinion?: number;
  rank?: string;
} = {}): GameState {
  const state = createNewGameState(db);
  const existing = state.standing["wenya"]!;
  return {
    ...state,
    standing: {
      ...state.standing,
      wenya: {
        ...existing,
        rank: opts.rank ?? "changzai",
        favor: opts.favor ?? 30,
        ...(opts.loyalty !== undefined ? { loyalty: opts.loyalty } : {}),
        household: {
          ...HOUSEHOLD_DEFAULTS,
          ...(existing.household ?? {}),
          ...(opts.servantOpinion !== undefined ? { servantOpinion: opts.servantOpinion } : {}),
        },
        personality: { ...PERSONALITY_DEFAULTS, ...(existing.personality ?? {}) },
      },
    },
  };
}

function withCalendar(state: GameState, month: number, period: "early" | "mid" | "late", year = 1): GameState {
  return { ...state, calendar: cal(month, period, year) };
}

// ─── AR-01..04: isHaremAdminReviewWindow ─────────────────────────────────────

describe("isHaremAdminReviewWindow", () => {
  it("AR-01: month 5 → false", () => {
    expect(isHaremAdminReviewWindow(cal(5, "late"))).toBe(false);
  });

  it("AR-02: month 6 early → false", () => {
    expect(isHaremAdminReviewWindow(cal(6, "early"))).toBe(false);
  });

  it("AR-03: month 6 late → true (触发窗口)", () => {
    expect(isHaremAdminReviewWindow(cal(6, "late"))).toBe(true);
  });

  it("AR-04: month 7 early → true", () => {
    expect(isHaremAdminReviewWindow(cal(7, "early"))).toBe(true);
  });

  it("AR-04b: month 12 late → true", () => {
    expect(isHaremAdminReviewWindow(cal(12, "late"))).toBe(true);
  });
});

// ─── AR-05..06: hasHaremAdminReviewForYear ────────────────────────────────────

describe("hasHaremAdminReviewForYear", () => {
  it("AR-05: empty array → false", () => {
    const state = createNewGameState(db);
    expect(hasHaremAdminReviewForYear(state, 1)).toBe(false);
  });

  it("AR-06: record for year 1 → true; year 2 → false", () => {
    const state = createNewGameState(db);
    const record: HaremAdminReviewRecord = {
      id: "harem_admin_review_1",
      year: 1,
      outcome: "no_candidate",
      settledAt: makeGameTime(1, 7, "early"),
      acknowledged: true,
    };
    const s = { ...state, haremAdminReviews: [record] };
    expect(hasHaremAdminReviewForYear(s, 1)).toBe(true);
    expect(hasHaremAdminReviewForYear(s, 2)).toBe(false);
  });
});

// ─── AR-07..08: oldestPendingHaremAdminReport ─────────────────────────────────

describe("oldestPendingHaremAdminReport", () => {
  it("AR-07: no reviews → null", () => {
    expect(oldestPendingHaremAdminReport(createNewGameState(db))).toBeNull();
  });

  it("AR-08: 只返回 rank_changed 未读，oldest by year", () => {
    const state = createNewGameState(db);
    const rankChangedDecision: HaremAdminReviewRecord["decision"] = {
      targetId: "wenya", direction: "promote", fromRankId: "changzai", toRankId: "cairen",
      reason: "service_merit", score: 5,
    };
    const r1: HaremAdminReviewRecord = {
      id: "harem_admin_review_2",
      year: 2,
      outcome: "rank_changed",
      decision: rankChangedDecision,
      settledAt: makeGameTime(2, 7, "early"),
      acknowledged: false,
    };
    const r2: HaremAdminReviewRecord = {
      id: "harem_admin_review_1",
      year: 1,
      outcome: "rank_changed",
      decision: rankChangedDecision,
      settledAt: makeGameTime(1, 7, "early"),
      acknowledged: false,
    };
    // no_candidate 不进入 pending 队列
    const r3: HaremAdminReviewRecord = {
      id: "harem_admin_review_3",
      year: 3,
      outcome: "no_candidate",
      settledAt: makeGameTime(3, 7, "early"),
      acknowledged: true,
    };
    const s = { ...state, haremAdminReviews: [r1, r2, r3] };
    expect(oldestPendingHaremAdminReport(s)?.id).toBe("harem_admin_review_1");
  });

  it("AR-08b: no_candidate（acknowledged=true）不出现在 pending 队列", () => {
    const state = createNewGameState(db);
    const r: HaremAdminReviewRecord = {
      id: "harem_admin_review_1",
      year: 1,
      outcome: "no_candidate",
      settledAt: makeGameTime(1, 7, "early"),
      acknowledged: true,
    };
    expect(oldestPendingHaremAdminReport({ ...state, haremAdminReviews: [r] })).toBeNull();
  });
});

// ─── AR-09..10: no_administrator ─────────────────────────────────────────────

describe("settleAnnualHaremAdminReview — no_administrator", () => {
  it("AR-09: neiwu_proxy mode → no_administrator 记录", () => {
    const state = withCalendar(createNewGameState(db), 7, "early");
    const s = {
      ...state,
      haremAdministration: {
        mode: "neiwu_proxy" as const,
        appointedAt: makeGameTime(1, 1, "early"),
        reason: "empress_confined" as const,
      },
    };
    const result = settleAnnualHaremAdminReview(db, s);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const review = result.value.haremAdminReviews[0]!;
    expect(review.outcome).toBe("no_administrator");
    expect(review.year).toBe(1);
    expect(review.acknowledged).toBe(true); // no_administrator 直接幂等，不打断玩家
    expect(review.id).toBe("harem_admin_review_1");
  });
});

// ─── AR-11..12: no_candidate ─────────────────────────────────────────────────

describe("settleAnnualHaremAdminReview — no_candidate", () => {
  it("AR-11: 无合格候选 → no_candidate，acknowledged=true（不打断玩家）", () => {
    // wenya favor=10, loyalty=60, servantOpinion=60: 不符合晋位（favor<45），也不符合降位
    const state = withCalendar(wenyaFixture({ favor: 10, loyalty: 60, servantOpinion: 60 }), 7, "early");
    const result = settleAnnualHaremAdminReview(db, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.value.haremAdminReviews[0]!;
    expect(r.outcome).toBe("no_candidate");
    expect(r.acknowledged).toBe(true);
    expect(oldestPendingHaremAdminReport(result.value)).toBeNull(); // 不进中断队列
  });

  it("AR-12: acting_consort 主理、无低位候选 → no_candidate 精确断言", () => {
    // wenya=皇后，xu_qinghuan=acting_consort 且 rank=fu（176>116 不可被降位）
    // lu_huaijin=chenghui（156>116）→ 全部高于贵人边界，无候选
    const state = createNewGameState(db);
    const wenyaSt = state.standing["wenya"]!;
    const xuSt = state.standing["xu_qinghuan"]!;
    const s: GameState = {
      ...state,
      calendar: cal(7, "early"),
      standing: {
        ...state.standing,
        wenya: { ...wenyaSt, rank: "huanghou" },
        xu_qinghuan: { ...xuSt, rank: "fu", favor: 10 },
      },
      haremAdministration: {
        mode: "acting_consort",
        charId: "xu_qinghuan",
        appointedAt: makeGameTime(1, 1, "early"),
        reason: "empress_confined",
      },
    };
    const result = settleAnnualHaremAdminReview(db, s);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.haremAdminReviews[0]!.outcome).toBe("no_candidate");
  });
});

// ─── AR-13..16: rank_changed ─────────────────────────────────────────────────

describe("settleAnnualHaremAdminReview — rank_changed", () => {
  it("AR-13: 符合晋位条件 → rank_changed，保存完整 decision 快照", () => {
    // wenya: favor=60, loyalty=60, servantOpinion=60 → 晋位
    const state = withCalendar(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }), 7, "early");
    const result = settleAnnualHaremAdminReview(db, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const review = result.value.haremAdminReviews[0]!;
    expect(review.outcome).toBe("rank_changed");
    expect(review.administratorId).toBeTruthy();
    expect(review.office).toBe("empress");
    expect(review.decision).toBeDefined();
    expect(review.decision?.targetId).toBe("wenya");
    expect(review.decision?.direction).toBe("promote");
    expect(review.decision?.fromRankId).toBeTruthy();
    expect(review.decision?.toRankId).toBeTruthy();
    expect(review.decision?.fromRankId).not.toBe(review.decision?.toRankId);
    expect(review.decision?.reason).toBeTruthy();
    expect(typeof review.decision?.score).toBe("number");
  });

  it("AR-14: 符合降位条件 → rank_changed（降位），decision.direction=demote", () => {
    // wenya: favor=20, loyalty=10, servantOpinion=10 → 降位
    const state = withCalendar(wenyaFixture({ favor: 20, loyalty: 10, servantOpinion: 10 }), 7, "early");
    const result = settleAnnualHaremAdminReview(db, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const review = result.value.haremAdminReviews[0]!;
    expect(review.outcome).toBe("rank_changed");
    expect(review.decision?.targetId).toBe("wenya");
    expect(review.decision?.direction).toBe("demote");
  });

  it("AR-15: rank_changed 时 state.standing 实际改变", () => {
    const state = withCalendar(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }), 7, "early");
    const before = state.standing["wenya"]!.rank;
    const result = settleAnnualHaremAdminReview(db, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.standing["wenya"]!.rank;
    expect(after).not.toBe(before);
  });

  it("AR-16: rank_changed 追加编年史 chronicle 条目", () => {
    const state = withCalendar(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }), 7, "early");
    const before = state.chronicle.length;
    const result = settleAnnualHaremAdminReview(db, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.chronicle.length).toBeGreaterThan(before);
  });
});

// ─── AR-17: 幂等 ─────────────────────────────────────────────────────────────

describe("settleAnnualHaremAdminReview — 幂等", () => {
  it("AR-17: hasHaremAdminReviewForYear 后不再触发", () => {
    const state = withCalendar(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }), 7, "early");
    const first = settleAnnualHaremAdminReview(db, state);
    expect(first.ok).toBe(true);
    // 手动守卫，模拟 settlePostAdvance 逻辑
    if (!first.ok) return;
    expect(hasHaremAdminReviewForYear(first.value, 1)).toBe(true);
  });
});

// ─── AR-18: acknowledged=false 初始 ───────────────────────────────────────────

it("AR-18: 新生成记录 acknowledged=false", () => {
  const state = withCalendar(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }), 7, "early");
  const result = settleAnnualHaremAdminReview(db, state);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.haremAdminReviews[0]!.acknowledged).toBe(false);
});

// ─── AR-19: settledAt 时间戳匹配日历 ─────────────────────────────────────────

it("AR-19: settledAt 与 state.calendar 一致", () => {
  const state = withCalendar(wenyaFixture({ favor: 10, loyalty: 60, servantOpinion: 60 }), 7, "early", 3);
  const result = settleAnnualHaremAdminReview(db, state);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.haremAdminReviews[0]!.settledAt.year).toBe(3);
  expect(result.value.haremAdminReviews[0]!.settledAt.month).toBe(7);
});

// ─── AR-20..21: GameStore.acknowledgeHaremAdminReview ────────────────────────

describe("GameStore.acknowledgeHaremAdminReview", () => {
  it("AR-20: 已知 id → 返回 true，acknowledged 置 true", () => {
    const state = createNewGameState(db);
    const r: HaremAdminReviewRecord = {
      id: "harem_admin_review_1",
      year: 1,
      outcome: "no_candidate",
      settledAt: makeGameTime(1, 7, "early"),
      acknowledged: false,
    };
    const store = new GameStore();
    store.loadState({ ...state, haremAdminReviews: [r] });
    expect(store.acknowledgeHaremAdminReview("harem_admin_review_1")).toBe(true);
    expect(store.getState().haremAdminReviews[0]!.acknowledged).toBe(true);
  });

  it("AR-21: 未知 id 或已 acknowledged → 返回 false", () => {
    const state = createNewGameState(db);
    const r: HaremAdminReviewRecord = {
      id: "harem_admin_review_1",
      year: 1,
      outcome: "no_candidate",
      settledAt: makeGameTime(1, 7, "early"),
      acknowledged: true,
    };
    const store = new GameStore();
    store.loadState({ ...state, haremAdminReviews: [r] });
    expect(store.acknowledgeHaremAdminReview("harem_admin_review_1")).toBe(false);
    expect(store.acknowledgeHaremAdminReview("no_such_id")).toBe(false);
  });
});

// ─── AR-22..24: advanceTime 集成 ────────────────────────────────────────────

describe("advanceTime 集成", () => {
  it("AR-22: 跨入六月下旬触发例核一次（rank_changed 或 no_candidate 均可）", () => {
    const base = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const store = new GameStore();
    store.loadState({
      ...base,
      calendar: {
        ...base.calendar,
        year: 1, month: 6, period: "mid",
        dayIndex: dayIndexOf(1, 6, "mid"),
        ap: 1,
      },
    });
    expect(hasHaremAdminReviewForYear(store.getState(), 1)).toBe(false);
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(store.getState().calendar.month).toBe(6);
    expect(store.getState().calendar.period).toBe("late");
    expect(hasHaremAdminReviewForYear(store.getState(), 1)).toBe(true);
    expect(store.getState().haremAdminReviews[0]!.year).toBe(1);
  });

  it("AR-23: 同月内多次推进不重复触发例核", () => {
    const base = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const store = new GameStore();
    store.loadState({
      ...base,
      calendar: {
        ...base.calendar,
        year: 1, month: 6, period: "mid",
        dayIndex: dayIndexOf(1, 6, "mid"),
        ap: 1,
      },
    });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    expect(store.getState().haremAdminReviews.filter((r) => r.year === 1)).toHaveLength(1);
  });

  it("AR-24: catch-up — 跳入七月下旬仍触发", () => {
    const base = wenyaFixture({ favor: 10, loyalty: 60, servantOpinion: 60 });
    const store = new GameStore();
    store.loadState({
      ...base,
      calendar: {
        ...base.calendar,
        year: 1, month: 7, period: "mid",
        dayIndex: dayIndexOf(1, 7, "mid"),
        ap: 1,
      },
      haremAdminReviews: [],
    });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(hasHaremAdminReviewForYear(store.getState(), 1)).toBe(true);
  });
});

// ─── AR-25: save version ─────────────────────────────────────────────────────

it("AR-25: SAVE_FORMAT_VERSION = 29", () => {
  expect(SAVE_FORMAT_VERSION).toBe(29);
});

// ─── AR-26: round-trip save/load ─────────────────────────────────────────────

it("AR-26: haremAdminReviews 随存档 round-trip（含完整 decision 快照）", () => {
  const state = createNewGameState(db);
  const r: HaremAdminReviewRecord = {
    id: "harem_admin_review_1",
    year: 1,
    outcome: "rank_changed",
    administratorId: "wenya",
    office: "empress",
    decision: {
      targetId: "lu_huaijin",
      direction: "promote",
      fromRankId: "changzai",
      toRankId: "cairen",
      reason: "service_merit",
      score: 5.2,
    },
    settledAt: makeGameTime(1, 7, "early"),
    acknowledged: false,
  };
  const s = { ...state, haremAdminReviews: [r] };
  const storage = createMemoryStorage();
  const envelope = createSaveData(db, s, "slot1");
  storage.set(SAVE_KEY_PREFIX + "slot1", JSON.stringify(envelope));
  const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.value.state.haremAdminReviews).toHaveLength(1);
  const loaded0 = loaded.value.state.haremAdminReviews[0]!;
  expect(loaded0.outcome).toBe("rank_changed");
  expect(loaded0.administratorId).toBe("wenya");
  expect(loaded0.office).toBe("empress");
  expect(loaded0.decision?.targetId).toBe("lu_huaijin");
  expect(loaded0.decision?.reason).toBe("service_merit");
  expect(loaded0.decision?.score).toBe(5.2);
  expect(loaded0.acknowledged).toBe(false);
});

// ─── AR-27: migration v29 回填 ───────────────────────────────────────────────

it("AR-27: v28 存档升级 v29 后 haremAdminReviews 回填为 []", () => {
  const s = createNewGameState(db);
  const stateWithout = structuredClone(s) as unknown as Record<string, unknown>;
  delete stateWithout.haremAdminReviews;
  const envelope = createSaveData(db, s, "slot1");
  const storage = createMemoryStorage();
  storage.set(SAVE_KEY_PREFIX + "slot1", JSON.stringify({
    ...envelope,
    formatVersion: 28,
    state: stateWithout,
    checksum: checksumOf(stateWithout as unknown as GameState),
  }));
  const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
  if (!loaded.ok) console.error("migration error:", JSON.stringify(loaded.error));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(Array.isArray(loaded.value.state.haremAdminReviews)).toBe(true);
  expect(loaded.value.state.haremAdminReviews).toHaveLength(0);
});

// ─── AR-28..32: buildHaremAdminReviewLine ────────────────────────────────────

type RankChangedReview = HaremAdminReviewRecord & { outcome: "rank_changed"; decision: NonNullable<HaremAdminReviewRecord["decision"]> };

/** 生成 rank_changed 例核记录用于 buildHaremAdminReviewLine 测试。 */
function makeRankChangedReview(decisionOverrides?: Partial<NonNullable<HaremAdminReviewRecord["decision"]>>, recordOverrides?: Partial<HaremAdminReviewRecord>): RankChangedReview {
  return {
    id: "harem_admin_review_1",
    year: 1,
    outcome: "rank_changed",
    administratorId: "wenya",
    office: "empress",
    settledAt: makeGameTime(1, 7, "early"),
    acknowledged: false,
    ...recordOverrides,
    decision: {
      targetId: "wenya",
      direction: "promote",
      fromRankId: "changzai",
      toRankId: "cairen",
      reason: "service_merit",
      score: 5,
      ...decisionOverrides,
    },
  } as RankChangedReview;
}

describe("buildHaremAdminReviewLine", () => {
  it("AR-28: 皇后晋位报告含「皇后」、原位分和新位分，不重复新位分", () => {
    // wenya 是固定角色，有 surname="文"；皇后晋 wenya → 文氏，常在→才人
    const review = makeRankChangedReview(
      { targetId: "wenya", direction: "promote", fromRankId: "changzai", toRankId: "cairen" },
      { administratorId: "wenya", office: "empress" },
    );
    const line = buildHaremAdminReviewLine(db, review);
    expect(line).toContain("皇后");
    expect(line).toContain(db.ranks["changzai"]?.name ?? "changzai"); // 原位分
    expect(line).toContain(db.ranks["cairen"]?.name ?? "cairen");     // 新位分
    // 不能以「才人文氏晋为才人」这种形式重复
    const toRankName = db.ranks["cairen"]?.name ?? "cairen";
    const doubled = `${toRankName}.*${toRankName}`;
    expect(line).not.toMatch(new RegExp(doubled));
  });

  it("AR-29: acting_consort 报告含行政者姓名而非「皇后」", () => {
    // xu_qinghuan surname="许"，acting_consort 主理
    const review = makeRankChangedReview(
      { targetId: "wenya", direction: "demote", fromRankId: "cairen", toRankId: "changzai" },
      { administratorId: "xu_qinghuan", office: "acting_consort" },
    );
    const line = buildHaremAdminReviewLine(db, review);
    expect(line).not.toContain("皇后");
    expect(line).toContain("协理六宫");
    const char = db.characters["xu_qinghuan"]!;
    const expectedName = char.profile.surname ? char.profile.surname + "氏" : char.profile.name;
    expect(line).toContain(expectedName);
  });

  it("AR-30: 降位报告使用 fromRankId→toRankId，且含「降为」", () => {
    const review = makeRankChangedReview({ direction: "demote", fromRankId: "cairen", toRankId: "changzai" });
    const line = buildHaremAdminReviewLine(db, review);
    expect(line).toContain(db.ranks["cairen"]?.name ?? "cairen");   // fromRankId
    expect(line).toContain(db.ranks["changzai"]?.name ?? "changzai"); // toRankId
    expect(line).toContain("降为");
  });

  it("AR-31: generated consort（有姓）使用「某氏」形式", () => {
    const genChar = {
      ...db.characters["wenya"]!,
      profile: { ...db.characters["wenya"]!.profile, surname: "林", name: "林小雪" },
    };
    const db_ = { ...db, characters: { ...db.characters, gen_1: genChar } };
    const review = makeRankChangedReview(
      { targetId: "gen_1", direction: "promote", fromRankId: "changzai", toRankId: "cairen" },
    );
    const line = buildHaremAdminReviewLine(db_, review);
    expect(line).toContain("林氏");
  });

  it("AR-32: service_merit→念其侍奉勤谨；household_disorder→以其宫中失序", () => {
    const r1 = makeRankChangedReview({ reason: "service_merit" });
    expect(buildHaremAdminReviewLine(db, r1)).toContain("念其侍奉勤谨");
    const r2 = makeRankChangedReview({ reason: "household_disorder" });
    expect(buildHaremAdminReviewLine(db, r2)).toContain("以其宫中失序");
  });
});

// ─── AR-33: invalid acting_consort → no_administrator ────────────────────────

describe("settleAnnualHaremAdminReview — invalid acting_consort", () => {
  it("AR-33: acting_consort 已死亡 → no_administrator 而非 no_candidate", () => {
    const state = withCalendar(createNewGameState(db), 7, "early");
    const xuSt = state.standing["xu_qinghuan"]!;
    const s: GameState = {
      ...state,
      standing: {
        ...state.standing,
        xu_qinghuan: { ...xuSt, lifecycle: "deceased" as const },
      },
      haremAdministration: {
        mode: "acting_consort",
        charId: "xu_qinghuan",
        appointedAt: makeGameTime(1, 1, "early"),
        reason: "empress_confined",
      },
    };
    const result = settleAnnualHaremAdminReview(db, s);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.haremAdminReviews[0]!.outcome).toBe("no_administrator");
    expect(result.value.haremAdminReviews[0]!.acknowledged).toBe(true);
  });
});
