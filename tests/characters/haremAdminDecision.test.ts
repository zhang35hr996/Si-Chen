/**
 * 六宫自主位分决策引擎测试（AD 系列，30 项）
 *
 * 所有测试使用「孤立 fixture」策略：
 *   - wenya 置于常在（changzai, order 84，低于贵人 116）作为唯一候选
 *   - xu_qinghuan（驸 176）和 lu_huaijin（承徽 156）均高于贵人边界 → 自动排除
 *   - 每项测试显式断言 targetId / direction / reason / fromRankId / toRankId
 *   - 禁止 `if (!result) return` 或 `expect(true).toBe(true)` 形式的空测试
 *
 * 关键领域区分（防止 favor/affection 混用）：
 *   favor    = st.favor  — 皇帝公开恩宠等级，晋位门槛和评分依据
 *   affection = hidden attr — 私人情意，不影响位分决策
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  nextAdministrativeRank,
  previousAdministrativeRank,
  planAdministratorRankDecision,
} from "../../src/engine/characters/haremAdminDecision";
import {
  planAdministratorRankDecision as storeDecision,
  resolveHaremAdminRankCommand,
} from "../../src/store/haremAdminCommands";
import { loadRealContent } from "../helpers/contentFixture";
import { makeGameTime, toGameTime } from "../../src/engine/calendar/time";
import type { GameState, ConsortPersonality } from "../../src/engine/state/types";
import { HOUSEHOLD_DEFAULTS, PERSONALITY_DEFAULTS } from "../../src/engine/characters/consortAttrs";

const db = loadRealContent();

// ─── 共用工具 ────────────────────────────────────────────────────────────────

function baseState(): GameState {
  return createNewGameState(db);
}

/**
 * 孤立 fixture：wenya 位于常在（84），所有其他侍君（xu_qinghuan=驸176、
 * lu_huaijin=承徽156）均高于贵人边界 → wenya 是唯一可能的候选目标。
 * 参数可在此基础上精确设置 favor / loyalty / servantOpinion。
 */
function wenyaFixture(opts: {
  rank?: string;
  favor?: number;
  affection?: number;
  loyalty?: number;
  servantOpinion?: number;
  personality?: Partial<ConsortPersonality>;
}): GameState {
  const state = baseState();
  const existing = state.standing["wenya"]!;
  return {
    ...state,
    standing: {
      ...state.standing,
      wenya: {
        ...existing,
        rank: opts.rank ?? "changzai",
        favor: opts.favor ?? 30,
        ...(opts.affection !== undefined ? { affection: opts.affection } : {}),
        ...(opts.loyalty !== undefined ? { loyalty: opts.loyalty } : {}),
        household: {
          ...HOUSEHOLD_DEFAULTS,
          ...(existing.household ?? {}),
          ...(opts.servantOpinion !== undefined ? { servantOpinion: opts.servantOpinion } : {}),
        },
        personality: { ...PERSONALITY_DEFAULTS, ...(existing.personality ?? {}), ...(opts.personality ?? {}) },
      },
    },
  };
}

/**
 * 将 state 的日历推进至 year=2 month=1（第 25 个月），
 * 使得历史事件（最多 24 个月前）有足够空间不溢出到负时间。
 */
function advanceToYear2(state: GameState): GameState {
  const gt = makeGameTime(2, 1, "early");
  return { ...state, calendar: { ...state.calendar, ...gt } };
}

/**
 * 注入一条 harem_administration 标记的 rank_changed 事件（时间戳准确）。
 * 调用前须确保 state.calendar 已在 monthsAgo 个月之后（不会溢出到负时间）。
 */
function withAdminRankEvent(state: GameState, targetId: string, monthsAgo: number): GameState {
  const { year: curYear, month: curMonth } = state.calendar;
  const curMonthsFromEpoch = (curYear - 1) * 12 + (curMonth - 1);
  const eventMonthsFromEpoch = curMonthsFromEpoch - monthsAgo;
  if (eventMonthsFromEpoch < 0) {
    throw new Error(`Cannot place event ${monthsAgo}mo ago: calendar at year=${curYear} month=${curMonth} is too early`);
  }
  const eventYear = Math.floor(eventMonthsFromEpoch / 12) + 1;
  const eventMonth = (eventMonthsFromEpoch % 12) + 1;
  return {
    ...state,
    chronicle: [
      ...state.chronicle,
      {
        id: `test_admin_rank_${targetId}_ago${monthsAgo}`,
        type: "rank_changed" as const,
        occurredAt: makeGameTime(eventYear, eventMonth, "early"),
        participants: [
          { charId: "shen_zhibai", role: "administrator" as const },
          { charId: targetId, role: "recipient" as const },
        ],
        payload: {},
        publicity: { scope: "palace" as const, persistence: "institutional" as const },
        publicSalience: 60,
        retention: "slow" as const,
        tags: ["harem_administration", "rank_changed"],
      },
    ],
  };
}

// ─── AD-01..04  rank ladder helpers ──────────────────────────────────────────

describe("nextAdministrativeRank / previousAdministrativeRank", () => {
  it("AD-01: changzai(84) 晋一级 = cairen(92)", () => {
    expect(nextAdministrativeRank(db, "changzai")).toBe("cairen");
  });

  it("AD-02: cairen(92) 降一级 = changzai(84)", () => {
    expect(previousAdministrativeRank(db, "cairen")).toBe("changzai");
  });

  it("AD-03: 最低 harem 位分（guannanzi 52）降一级返回 null", () => {
    expect(previousAdministrativeRank(db, "guannanzi")).toBeNull();
  });

  it("AD-04: 未知位分 next / previous 均返回 null", () => {
    expect(nextAdministrativeRank(db, "__nonexistent__")).toBeNull();
    expect(previousAdministrativeRank(db, "__nonexistent__")).toBeNull();
  });
});

// ─── AD-05  neiwu_proxy / 非授权行政者 → null ─────────────────────────────────

describe("planAdministratorRankDecision — 模式拒绝", () => {
  it("AD-05: neiwu_proxy 模式 → null", () => {
    const state: GameState = {
      ...baseState(),
      haremAdministration: {
        mode: "neiwu_proxy",
        appointedAt: toGameTime(baseState().calendar),
        reason: "no_eligible_consort",
      },
    };
    expect(planAdministratorRankDecision(db, state, "shen_zhibai")).toBeNull();
  });

  it("AD-06: empress 模式 — administratorId 不匹配皇后 charId → null", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    expect(planAdministratorRankDecision(db, state, "xu_qinghuan")).toBeNull();
  });

  it("AD-07: acting_consort 模式 — administratorId 不匹配 admin.charId → null", () => {
    const base = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const state: GameState = {
      ...base,
      haremAdministration: {
        mode: "acting_consort",
        charId: "xu_qinghuan",
        appointedAt: toGameTime(base.calendar),
        reason: "empress_confined",
      },
    };
    expect(planAdministratorRankDecision(db, state, "shen_zhibai")).toBeNull();
  });
});

// ─── AD-08..11  promote 阈值（精确断言，wenya 是唯一候选）────────────────────

describe("planAdministratorRankDecision — promote 阈值", () => {
  it("AD-08: favor≥45 & loyalty≥50 & servantOpinion≥50 → promote wenya changzai→cairen", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe("wenya");
    expect(result!.direction).toBe("promote");
    expect(result!.fromRankId).toBe("changzai");
    expect(result!.toRankId).toBe("cairen");
    expect(result!.score).toBeGreaterThan(0);
  });

  it("AD-09: favor=44（低于门槛）→ null（即使 affection=100）", () => {
    const state = wenyaFixture({ favor: 44, affection: 100, loyalty: 70, servantOpinion: 70 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).toBeNull();
  });

  it("AD-10: favor=60, affection=0（情意极低）→ 仍可晋位（favor 才是门槛）", () => {
    const state = wenyaFixture({ favor: 60, affection: 0, loyalty: 60, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("promote");
  });

  it("AD-11: loyalty=49（低于门槛）→ null", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 49, servantOpinion: 70 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).toBeNull();
  });

  it("AD-12: servantOpinion=49（低于门槛）→ null", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 49 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).toBeNull();
  });
});

// ─── AD-13..15  demote 阈值 ───────────────────────────────────────────────────

describe("planAdministratorRankDecision — demote 阈值", () => {
  it("AD-13: loyalty≤25 → demote wenya changzai→daying", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 20, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe("wenya");
    expect(result!.direction).toBe("demote");
    expect(result!.fromRankId).toBe("changzai");
    expect(result!.toRankId).toBe("daying");
    expect(result!.score).toBeLessThan(0);
  });

  it("AD-14: servantOpinion≤25 → demote wenya", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 60, servantOpinion: 20 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("demote");
  });

  it("AD-15: loyalty=26, servantOpinion=26（均高于门槛）→ null（无 promote 条件）", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 26, servantOpinion: 26 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).toBeNull();
  });
});

// ─── AD-16..18  降位理由分类（在生成时确定）──────────────────────────────────

describe("planAdministratorRankDecision — 降位 reason", () => {
  it("AD-16: loyalty≤25, servantOpinion>25 → reason=disloyalty", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 20, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result!.reason).toBe("disloyalty");
  });

  it("AD-17: loyalty>25, servantOpinion≤25 → reason=household_disorder", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 60, servantOpinion: 20 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result!.reason).toBe("household_disorder");
  });

  it("AD-18: 两者均≤25, servantOpinion < loyalty → reason=household_disorder", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 20, servantOpinion: 10 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result!.reason).toBe("household_disorder");
  });

  it("AD-19: 两者均≤25, loyalty < servantOpinion → reason=disloyalty", () => {
    const state = wenyaFixture({ favor: 30, loyalty: 10, servantOpinion: 20 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result!.reason).toBe("disloyalty");
  });
});

// ─── AD-20..22  晋位理由分类 ─────────────────────────────────────────────────

describe("planAdministratorRankDecision — 晋位 reason", () => {
  it("AD-20: favor≥55 & loyalty≥60 → service_merit", () => {
    const state = wenyaFixture({ favor: 70, loyalty: 70, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result!.reason).toBe("service_merit");
  });

  it("AD-21: favor=47, loyalty=52 → household_order（刚好满足晋位但不达 service_merit 标准）", () => {
    const state = wenyaFixture({ favor: 47, loyalty: 52, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result!.direction).toBe("promote");
    expect(result!.reason).toBe("household_order");
  });
});

// ─── AD-23  compassion 修正方向（高仁慈 → 降低降位优先度）────────────────────

describe("planAdministratorRankDecision — 性格修正方向", () => {
  it("AD-23: 高 compassion 皇后降低降位 priority，低 compassion 皇后更倾向降位", () => {
    // 使皇后有 wenya 需要降位的状态
    const baseOpts = { favor: 30, loyalty: 10, servantOpinion: 60 };

    const highCompassion = wenyaFixture(baseOpts);
    const shenHighC = highCompassion.standing["shen_zhibai"]!;
    const stateHighC: GameState = {
      ...highCompassion,
      standing: {
        ...highCompassion.standing,
        shen_zhibai: { ...shenHighC, personality: { ...PERSONALITY_DEFAULTS, ...(shenHighC.personality ?? {}), compassion: 90 } },
      },
    };

    const lowCompassion = wenyaFixture(baseOpts);
    const shenLowC = lowCompassion.standing["shen_zhibai"]!;
    const stateLowC: GameState = {
      ...lowCompassion,
      standing: {
        ...lowCompassion.standing,
        shen_zhibai: { ...shenLowC, personality: { ...PERSONALITY_DEFAULTS, ...(shenLowC.personality ?? {}), compassion: 10 } },
      },
    };

    const resultHighC = planAdministratorRankDecision(db, stateHighC, "shen_zhibai");
    const resultLowC = planAdministratorRankDecision(db, stateLowC, "shen_zhibai");

    expect(resultHighC).not.toBeNull();
    expect(resultLowC).not.toBeNull();
    // 高仁慈的降位 priority（score 的绝对值）应低于低仁慈
    expect(Math.abs(resultHighC!.score)).toBeLessThan(Math.abs(resultLowC!.score));
  });
});

// ─── AD-24..25  冷却检查 ──────────────────────────────────────────────────────

describe("planAdministratorRankDecision — 冷却", () => {
  it("AD-24: 11 个月前由管理者调整过 → 仍在冷却期内 → null", () => {
    // 先推进到 year=2 month=1，再注入 11 个月前（year=1 month=2）的事件
    let state = advanceToYear2(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }));
    state = withAdminRankEvent(state, "wenya", 11);
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).toBeNull();
  });

  it("AD-25: 12 个月前调整过 → 冷却到期 → 可再次晋位", () => {
    let state = advanceToYear2(wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 }));
    state = withAdminRankEvent(state, "wenya", 12);
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe("wenya");
    expect(result!.direction).toBe("promote");
  });
});

// ─── AD-26  冷宫 / 禁足过滤 ─────────────────────────────────────────────────

describe("planAdministratorRankDecision — 冷宫/禁足", () => {
  it("AD-26: wenya 正在禁足 → 跳过 → null", () => {
    let state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    // 注入一条 confinement status effect
    state = {
      ...state,
      statusEffects: [
        ...state.statusEffects,
        {
          id: "test_confinement_wenya",
          kind: "confinement" as const,
          characterId: "wenya",
          startTurn: state.calendar.dayIndex,
          endTurnExclusive: null,
          imposedAt: toGameTime(state.calendar),
          imposedBy: "emperor" as const,
        },
      ],
    };
    const result = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(result).toBeNull();
  });
});

// ─── AD-27  确定性 ────────────────────────────────────────────────────────────

describe("planAdministratorRankDecision — 确定性", () => {
  it("AD-27: 相同 state 两次调用结果完全相同（幂等）", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const r1 = planAdministratorRankDecision(db, state, "shen_zhibai");
    const r2 = planAdministratorRankDecision(db, state, "shen_zhibai");
    expect(r1).toEqual(r2);
  });
});

// ─── AD-28..30  集成：store layer + resolver ────────────────────────────────

describe("store layer 集成", () => {
  it("AD-28: planAdministratorRankDecision 返回 decision + command + plan", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const planned = storeDecision(db, state, "shen_zhibai");
    expect(planned).not.toBeNull();
    expect(planned!.decision.targetId).toBe("wenya");
    expect(planned!.decision.direction).toBe("promote");
    expect(planned!.command.type).toBe("harem_admin_rank_change");
    expect(planned!.command.targetId).toBe("wenya");
    expect(planned!.command.request).toEqual({ kind: "set_rank", rank: "cairen" });
    expect(planned!.plan.effects.length).toBeGreaterThan(0);
    // reason 不丢失
    expect(["service_merit", "household_order", "disloyalty", "household_disorder"]).toContain(
      planned!.decision.reason,
    );
  });

  it("AD-29: resolveHaremAdminRankCommand 成功 → 返回新 state（wenya 已升为 cairen）", () => {
    const state = wenyaFixture({ favor: 60, loyalty: 60, servantOpinion: 60 });
    const planned = storeDecision(db, state, "shen_zhibai");
    expect(planned).not.toBeNull();

    const resolved = resolveHaremAdminRankCommand(db, state, planned!.command);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.state.standing["wenya"]?.rank).toBe("cairen");
  });

  it("AD-30: resolveHaremAdminRankCommand 权限拒绝 → 失败（目标已是贵人）", () => {
    const state = wenyaFixture({ rank: "guiren", favor: 60, loyalty: 60, servantOpinion: 60 });
    const result = resolveHaremAdminRankCommand(db, state, {
      type: "harem_admin_rank_change",
      actorId: "shen_zhibai",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "shaoshi" }, // shaoshi=124, 超过贵人边界
    });
    expect(result.ok).toBe(false);
  });
});
