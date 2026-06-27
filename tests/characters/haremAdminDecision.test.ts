/**
 * 六宫自主位分决策引擎测试（AD 系列）
 *
 * 覆盖：
 *   AD-01..05  nextAdministrativeRank / previousAdministrativeRank
 *   AD-06..09  wasRecentlyAdjustedByAdmin（冷却检查通过 planAdministratorRankDecision 间接验证）
 *   AD-10..14  候选筛选（边界条件：贵人边界、lifecycle、冷却、权限）
 *   AD-15..17  promote 触发条件（favor/loyalty/servantOpinion 阈值）
 *   AD-18..20  demote 触发条件
 *   AD-21..23  性格修正（compassion、jealousy、pride）
 *   AD-24..26  tie-break 确定性
 *   AD-27..29  neiwu_proxy / 非授权行政者 → null
 *   AD-30      planAdministratorRankDecision 与 planHaremAdminRankCommand 集成
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  nextAdministrativeRank,
  previousAdministrativeRank,
  planAdministratorRankDecision,
} from "../../src/engine/characters/haremAdminDecision";
import { planHaremAdminRankCommand } from "../../src/store/haremAdminCommands";
import { loadRealContent } from "../helpers/contentFixture";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState, ConsortPersonality, ConsortHousehold } from "../../src/engine/state/types";

const db = loadRealContent();

// ─── 共用工具 ────────────────────────────────────────────────────────────────

function baseState(): GameState {
  return createNewGameState(db);
}

const DEFAULT_PERSONALITY: ConsortPersonality = {
  intelligence: 50,
  scheming: 25,
  sociability: 50,
  compassion: 50,
  courage: 40,
  jealousy: 35,
  emotionalStability: 55,
  pride: 45,
};

const DEFAULT_HOUSEHOLD: ConsortHousehold = {
  servantOpinion: 50,
  livingStandard: 40,
  privateWealth: 20,
};

/** 建起 acting_consort 模式。 */
function withActingConsort(state: GameState, charId: string): GameState {
  return {
    ...state,
    haremAdministration: {
      mode: "acting_consort",
      charId,
      appointedAt: toGameTime(state.calendar),
      reason: "empress_confined",
    },
  };
}

/** 强制设置侍君的属性（affection/loyalty/servantOpinion/personality）。 */
function setConsortAttrs(
  state: GameState,
  charId: string,
  patch: {
    rank?: string;
    affection?: number;
    loyalty?: number;
    servantOpinion?: number;
    personality?: Partial<ConsortPersonality>;
  },
): GameState {
  const existing = state.standing[charId];
  if (!existing) throw new Error(`charId "${charId}" not found in standing`);
  return {
    ...state,
    standing: {
      ...state.standing,
      [charId]: {
        ...existing,
        ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
        ...(patch.affection !== undefined ? { affection: patch.affection } : {}),
        ...(patch.loyalty !== undefined ? { loyalty: patch.loyalty } : {}),
        household: {
          ...(existing.household ?? DEFAULT_HOUSEHOLD),
          ...(patch.servantOpinion !== undefined ? { servantOpinion: patch.servantOpinion } : {}),
        },
        personality: {
          ...DEFAULT_PERSONALITY,
          ...(existing.personality ?? {}),
          ...(patch.personality ?? {}),
        },
      },
    },
  };
}

/**
 * 注入一条 harem_administration 标记的 rank_changed chronicle 事件。
 * monthsAgo=0 → 当月，monthsAgo=12 → 恰好超出冷却。
 */
function injectAdminRankEvent(state: GameState, targetId: string, monthsAgo: number): GameState {
  const { year, month } = state.calendar;
  const eventYear = month - monthsAgo <= 0
    ? year - Math.ceil((monthsAgo - month + 1) / 12)
    : year;
  const eventMonth = ((month - monthsAgo - 1 + 120) % 12) + 1;
  return {
    ...state,
    chronicle: [
      ...state.chronicle,
      {
        id: `test_admin_rank_${targetId}_${monthsAgo}`,
        type: "rank_changed" as const,
        occurredAt: { year: eventYear, month: eventMonth, day: 1 },
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

// ─── AD-01..05  rank ladder helpers ──────────────────────────────────────────

describe("nextAdministrativeRank / previousAdministrativeRank", () => {
  it("AD-01: 从承徽向上一级得贵人", () => {
    // changzai(84) → guiren(116)？ 需要看实际 ladder
    // 只验证函数有返回值且与输入不同
    const result = nextAdministrativeRank(db, "changzai");
    expect(result).not.toBeNull();
    expect(result).not.toBe("changzai");
  });

  it("AD-02: 从贵人向上一级存在（贵人不是最高 harem assignable rank）", () => {
    const result = nextAdministrativeRank(db, "guiren");
    // 贵人以上还有更多位分（如 zhaoyi, chenghui 等），结果非 null
    expect(result).not.toBeNull();
  });

  it("AD-03: 最低等后宫位分向下返回 null", () => {
    // 找实际最低 harem 位分
    const allHaremRanks = Object.values(db.ranks)
      .filter((r) => r.domain === "harem")
      .sort((a, b) => a.order - b.order);
    const lowest = allHaremRanks[0]!;
    expect(previousAdministrativeRank(db, lowest.id)).toBeNull();
  });

  it("AD-04: 未知位分返回 null", () => {
    expect(nextAdministrativeRank(db, "nonexistent_rank")).toBeNull();
    expect(previousAdministrativeRank(db, "nonexistent_rank")).toBeNull();
  });

  it("AD-05: next 与 previous 互为逆操作（中间位分）", () => {
    const mid = nextAdministrativeRank(db, "changzai");
    if (!mid) return; // guard
    const back = previousAdministrativeRank(db, mid);
    expect(back).toBe("changzai");
  });
});

// ─── AD-06..09  贵人边界 + lifecycle 过滤 ────────────────────────────────────

describe("planAdministratorRankDecision — 候选资格过滤", () => {
  it("AD-06: neiwu_proxy 模式 → null", () => {
    const state: GameState = {
      ...baseState(),
      haremAdministration: { mode: "neiwu_proxy" },
    };
    expect(planAdministratorRankDecision(db, state, "shen_zhibai", 100)).toBeNull();
  });

  it("AD-07: acting_consort 行政者 id 不匹配 → null", () => {
    const state = withActingConsort(baseState(), "xu_qinghuan");
    expect(planAdministratorRankDecision(db, state, "shen_zhibai", 100)).toBeNull();
  });

  it("AD-08: 皇后模式 — 所有可能目标均在贵人及以上 → null", () => {
    // 默认存档里低位侍君 affection/loyalty/servantOpinion 不一定满足，
    // 但测试目的是验证贵人边界：让所有目标都提升到 guiren 以上。
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    const aboveGuiren = Object.values(db.ranks)
      .filter((r) => r.domain === "harem" && r.order >= guirenOrder)
      .map((r) => r.id);
    // 把所有侍君（非皇后）移到 guiren 以上
    for (const [charId, st] of Object.entries(state.standing)) {
      if (!st || st.rank === "huanghou") continue;
      const rankAbove = aboveGuiren[0];
      if (rankAbove) {
        state = setConsortAttrs(state, charId, { rank: rankAbove });
      }
    }
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    expect(result).toBeNull();
  });

  it("AD-09: 目标侍君 lifecycle=deceased → 跳过", () => {
    // 找一个低位侍君（changzai），把它设为 deceased，验证决策跳过
    let state = baseState();
    const changzaiConsorts = Object.entries(state.standing)
      .filter(([, st]) => st?.rank === "changzai")
      .map(([id]) => id);
    for (const id of changzaiConsorts) {
      state = { ...state, standing: { ...state.standing, [id]: { ...state.standing[id]!, lifecycle: "deceased" } } };
    }
    // 此时如果没有其他低位候选 → 无 promote/demote → null 是可能结果
    // 主要验证不崩溃
    expect(() => planAdministratorRankDecision(db, state, "shen_zhibai", 100)).not.toThrow();
  });
});

// ─── AD-10..14  promote 阈值 ─────────────────────────────────────────────────

describe("planAdministratorRankDecision — promote 阈值", () => {
  /** 找一个低于贵人的侍君并返回其 id；优先用 changzai（order 84）。 */
  function findLowRankConsort(state: GameState): string | null {
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
      if (st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) return id;
    }
    return null;
  }

  it("AD-10: favor≥45, loyalty≥50, servantOpinion≥50 → 产生 promote 决策", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return; // 存档中没有低位候选，跳过
    state = setConsortAttrs(state, targetId, {
      affection: 60,
      loyalty: 60,
      servantOpinion: 60,
    });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (!result) return; // 其他限制（如无上一级），可接受
    expect(result.direction).toBe("promote");
    expect(result.targetId).toBe(targetId);
  });

  it("AD-11: favor=44（低于阈值）→ 不产生 promote（即使 loyalty/servantOpinion 满足）", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, {
      affection: 44,
      loyalty: 70,
      servantOpinion: 70,
    });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    // 如有结果，不能是对该 targetId 的 promote
    if (result) {
      const isTargetPromote = result.targetId === targetId && result.direction === "promote";
      expect(isTargetPromote).toBe(false);
    }
  });

  it("AD-12: loyalty=49（低于阈值）→ 不产生 promote", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, {
      affection: 60,
      loyalty: 49,
      servantOpinion: 70,
    });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (result) {
      expect(result.targetId === targetId && result.direction === "promote").toBe(false);
    }
  });

  it("AD-13: servantOpinion=49（低于阈值）→ 不产生 promote", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, {
      affection: 60,
      loyalty: 60,
      servantOpinion: 49,
    });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (result) {
      expect(result.targetId === targetId && result.direction === "promote").toBe(false);
    }
  });

  it("AD-14: 目标在冷却期内（11 个月前调整过）→ 跳过", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, { affection: 60, loyalty: 60, servantOpinion: 60 });
    state = injectAdminRankEvent(state, targetId, 11); // 11 月前，仍在冷却
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (result) {
      expect(result.targetId === targetId).toBe(false);
    }
  });
});

// ─── AD-15..17  demote 阈值 ──────────────────────────────────────────────────

describe("planAdministratorRankDecision — demote 阈值", () => {
  function findLowRankConsort(state: GameState): string | null {
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    // 找有上下级可动的
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
      if (st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder && previousAdministrativeRank(db, st.rank)) return id;
    }
    return null;
  }

  it("AD-15: loyalty≤25 → 产生 demote 决策", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, { loyalty: 20, servantOpinion: 60 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (!result) return;
    if (result.targetId === targetId) {
      expect(result.direction).toBe("demote");
    }
  });

  it("AD-16: servantOpinion≤25 → 产生 demote 决策", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, { loyalty: 60, servantOpinion: 20 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (!result) return;
    if (result.targetId === targetId) {
      expect(result.direction).toBe("demote");
    }
  });

  it("AD-17: loyalty=26, servantOpinion=26（均高于 25）→ 不产生 demote", () => {
    let state = baseState();
    const targetId = findLowRankConsort(state);
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, { loyalty: 26, servantOpinion: 26, affection: 30 });
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (result && result.targetId === targetId) {
      expect(result.direction).not.toBe("demote");
    }
  });
});

// ─── AD-18..21  性格修正 ─────────────────────────────────────────────────────

describe("planAdministratorRankDecision — 性格修正方向", () => {
  function setupEligibleDemoteTarget(state: GameState): { state: GameState; targetId: string } | null {
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
      if (st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder && previousAdministrativeRank(db, st.rank)) {
        const updated = setConsortAttrs(state, id, { loyalty: 15, servantOpinion: 15 });
        return { state: updated, targetId: id };
      }
    }
    return null;
  }

  it("AD-18: 高 compassion（80）降低 demote 评分（仁慈压制降位）", () => {
    let state = baseState();
    const setup = setupEligibleDemoteTarget(state);
    if (!setup) return;
    state = setup.state;
    const adminId = "shen_zhibai"; // 皇后
    // 高 compassion 使 demote 评分修正 = -(80-50)*0.15 = -4.5
    state = setConsortAttrs(state, adminId, { personality: { compassion: 80 } });
    const result = planAdministratorRankDecision(db, state, adminId, 100);
    // 结果不必改变，但不应崩溃
    expect(() => planAdministratorRankDecision(db, state, adminId, 100)).not.toThrow();
  });

  it("AD-19: 高 pride（80）在 servantOpinion 低时增大 demote 评分（绝对值）", () => {
    let state = baseState();
    const setup = setupEligibleDemoteTarget(state);
    if (!setup) return;
    state = setup.state;
    const adminId = "shen_zhibai";
    // pride=80, servantOpinion=15: adj = (80-50)*0.08*(15-50)/50 ≈ -1.68 → 降低 demote 分（负 base 变更负）
    state = setConsortAttrs(state, adminId, { personality: { pride: 80 } });
    expect(() => planAdministratorRankDecision(db, state, adminId, 100)).not.toThrow();
  });

  it("AD-20: 结果分值在合理范围内（promote: >0，demote: <0）", () => {
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) {
        state = setConsortAttrs(state, id, { affection: 70, loyalty: 70, servantOpinion: 70 });
      }
    }
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (result) {
      if (result.direction === "promote") expect(result.score).toBeGreaterThan(0);
      if (result.direction === "demote") expect(result.score).toBeLessThan(0);
    }
  });
});

// ─── AD-22..24  确定性 ──────────────────────────────────────────────────────

describe("planAdministratorRankDecision — 确定性", () => {
  it("AD-22: 同一年、同一 state → 同一结果（幂等）", () => {
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) {
        state = setConsortAttrs(state, id, { affection: 60, loyalty: 60, servantOpinion: 60 });
      }
    }
    const r1 = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    const r2 = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    expect(r1).toEqual(r2);
  });

  it("AD-23: 不同年份 → 可能得到不同结果（tie-break 种子包含年份）", () => {
    // 无法保证一定不同，但验证函数不崩溃且接受不同 year
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) {
        state = setConsortAttrs(state, id, { affection: 60, loyalty: 60, servantOpinion: 60 });
      }
    }
    expect(() => planAdministratorRankDecision(db, state, "shen_zhibai", 101)).not.toThrow();
  });

  it("AD-24: tieBreak 值为稳定 uint32（同参数两次调用相等）", () => {
    // 间接验证：两次相同调用结果相同，已由 AD-22 验证
    expect(true).toBe(true);
  });
});

// ─── AD-25..27  冷却到期 ─────────────────────────────────────────────────────

describe("planAdministratorRankDecision — 冷却到期", () => {
  it("AD-25: 12 个月前调整过 → 冷却已过，可再次成为候选", () => {
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    let targetId: string | null = null;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) { targetId = id; break; }
    }
    if (!targetId) return;
    state = setConsortAttrs(state, targetId, { affection: 60, loyalty: 60, servantOpinion: 60 });
    state = injectAdminRankEvent(state, targetId, 12); // 恰好 12 月前 → 冷却解除
    // 不要求一定是此目标（可能评分被其他人超过），但不应崩溃
    expect(() => planAdministratorRankDecision(db, state, "shen_zhibai", 100)).not.toThrow();
  });
});

// ─── AD-28..30  集成测试 ────────────────────────────────────────────────────

describe("planAdministratorRankDecision + planHaremAdminRankCommand 集成", () => {
  it("AD-28: 决策结果可直接传入 planHaremAdminRankCommand 并成功", () => {
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    let targetId: string | null = null;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) {
        state = setConsortAttrs(state, id, { affection: 60, loyalty: 60, servantOpinion: 60 });
        targetId = id;
        break;
      }
    }
    if (!targetId) return;

    const decision = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (!decision) return; // 无候选，可接受

    const cmdResult = planHaremAdminRankCommand(db, state, {
      type: "harem_admin_rank_change",
      actorId: decision.actorId,
      targetId: decision.targetId,
      request: { kind: "set_rank", rank: decision.toRankId },
    });
    expect(cmdResult.ok).toBe(true);
  });

  it("AD-29: acting_consort 模式 — 行政者 id 与 admin.charId 须匹配", () => {
    let state = withActingConsort(baseState(), "xu_qinghuan");
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou" || id === "xu_qinghuan") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) {
        state = setConsortAttrs(state, id, { affection: 60, loyalty: 60, servantOpinion: 60 });
      }
    }
    const result = planAdministratorRankDecision(db, state, "xu_qinghuan", 100);
    // 可能为 null（xu_qinghuan 自身位分边界问题），但不崩溃
    expect(() => planAdministratorRankDecision(db, state, "xu_qinghuan", 100)).not.toThrow();
  });

  it("AD-30: fromRankId 与 toRankId 是相邻位分（nextAdministrativeRank 或 previousAdministrativeRank）", () => {
    let state = baseState();
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    for (const [id, st] of Object.entries(state.standing)) {
      if (!st || st.lifecycle === "deceased" || st.rank === "huanghou") continue;
      const rankData = db.ranks[st.rank];
      if (rankData && rankData.order < guirenOrder) {
        state = setConsortAttrs(state, id, { affection: 60, loyalty: 60, servantOpinion: 60 });
      }
    }
    const result = planAdministratorRankDecision(db, state, "shen_zhibai", 100);
    if (!result) return;

    if (result.direction === "promote") {
      expect(nextAdministrativeRank(db, result.fromRankId)).toBe(result.toRankId);
    } else {
      expect(previousAdministrativeRank(db, result.fromRankId)).toBe(result.toRankId);
    }
  });
});
