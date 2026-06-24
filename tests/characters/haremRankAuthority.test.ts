/**
 * 六宫行政位分处分权测试（20 项）
 *
 * 测试 getHaremRankAuthority() 与 canAdministratorAdjustRank()，
 * 以及 funnel 层对 set_rank authority 的校验。
 *
 * 测试环境角色：
 *   shen_zhibai — 凤后（fenghou，kunninggong）
 *   xu_qinghuan — 君（jun, order 160，xianfugong）  ← 代理侍君
 *   wenya       — 承徽（chenghui, order 134，changmengong）← 目标
 *   lu_huaijin  — 承徽（chenghui, order 134，zhongcui_gong）← 目标
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { getHaremRankAuthority, canAdministratorAdjustRank, canEmpressAdjustRank } from "../../src/engine/characters/haremRankAuthority";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { loadRealContent } from "../helpers/contentFixture";
import { toGameTime } from "../../src/engine/calendar/time";
import { GameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

// ─── 共用工具 ────────────────────────────────────────────────────────────────

function baseState(): GameState {
  return createNewGameState(db);
}

/** 凤后禁足状态效果 */
function confineFenghouState(state: GameState): GameState {
  const now = toGameTime(state.calendar);
  return {
    ...state,
    statusEffects: [
      ...state.statusEffects,
      {
        id: "status_shen_zhibai_000001",
        kind: "confinement" as const,
        characterId: "shen_zhibai",
        startTurn: state.calendar.dayIndex,
        endTurnExclusive: null,
        imposedAt: now,
        imposedBy: "emperor" as const,
      },
    ],
  };
}

/** 凤后禁足 + haremAdministration 设为 xu_qinghuan 代理 */
function withActingConsort(state: GameState, charId = "xu_qinghuan"): GameState {
  const confined = confineFenghouState(state);
  return {
    ...confined,
    haremAdministration: {
      mode: "acting_consort",
      charId,
      appointedAt: toGameTime(state.calendar),
      reason: "empress_confined",
    },
  };
}

// ─── I. getHaremRankAuthority ─────────────────────────────────────────────────

describe("getHaremRankAuthority", () => {
  it("RA-01b: empress 模式 → harem_administrator/<凤后charId>，maxTargetOrder = fenghou.order - 1", () => {
    const state = baseState(); // haremAdmin.mode = "empress"
    const auth = getHaremRankAuthority(db, state);
    expect(auth.kind).toBe("harem_administrator");
    if (auth.kind === "harem_administrator") {
      // 凤后 charId 应为 shen_zhibai（新游戏默认凤后）
      expect(auth.actorId).toBe("shen_zhibai");
      expect(auth.maxTargetOrder).toBe((db.ranks["fenghou"]?.order ?? 1000) - 1);
    }
  });

  it("RA-02: acting_consort 模式 → harem_administrator，actorId 为协理者，maxTargetOrder = actorRankOrder - 1", () => {
    const state = withActingConsort(baseState());
    const auth = getHaremRankAuthority(db, state);
    expect(auth.kind).toBe("harem_administrator");
    if (auth.kind === "harem_administrator") {
      expect(auth.actorId).toBe("xu_qinghuan");
      const junOrder = db.ranks["jun"]?.order ?? 160;
      expect(auth.maxTargetOrder).toBe(junOrder - 1);
    }
  });

  it("RA-03: neiwu_proxy 模式 → none，附带原因", () => {
    const state: GameState = {
      ...confineFenghouState(baseState()),
      haremAdministration: {
        mode: "neiwu_proxy",
        appointedAt: toGameTime(baseState().calendar),
        reason: "no_eligible_consort",
      },
    };
    const auth = getHaremRankAuthority(db, state);
    expect(auth.kind).toBe("none");
    if (auth.kind === "none") {
      expect(auth.reason.length).toBeGreaterThan(0);
    }
  });

  it("RA-04: acting_consort 协理者 standing 缺失 → none", () => {
    const state: GameState = {
      ...confineFenghouState(baseState()),
      haremAdministration: {
        mode: "acting_consort",
        charId: "nonexistent_consort",
        appointedAt: toGameTime(baseState().calendar),
        reason: "empress_confined",
      },
    };
    const auth = getHaremRankAuthority(db, state);
    expect(auth.kind).toBe("none");
  });
});

// ─── II. canAdministratorAdjustRank 前置条件 ─────────────────────────────────

describe("canAdministratorAdjustRank — 前置条件校验", () => {
  it("RA-05: haremAdmin 不是 acting_consort → 拒绝", () => {
    const state = baseState(); // mode = "empress"
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-06: actorId 与协理者 charId 不符 → 拒绝", () => {
    const state = withActingConsort(baseState()); // charId = xu_qinghuan
    const result = canAdministratorAdjustRank(db, state, "wenya", "lu_huaijin", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-07: 协理者调整自己的位分 → 拒绝", () => {
    const state = withActingConsort(baseState());
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "xu_qinghuan", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-08: acting_consort 模式不要求凤后禁足（PUNISH-3A imperial_deprivation 路径）→ 允许", () => {
    // PUNISH-3A 后：权威判据为 haremAdministration.mode，不再要求凤后禁足。
    // imperial_deprivation/empress_illness 委任均不伴随凤后禁足。
    const state: GameState = {
      ...baseState(),
      haremAdministration: {
        mode: "acting_consort",
        charId: "xu_qinghuan",
        appointedAt: toGameTime(baseState().calendar),
        reason: "imperial_deprivation",
      },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(true);
  });

  it("RA-09: 协理者生命周期 = deceased → 拒绝", () => {
    const state: GameState = {
      ...withActingConsort(baseState()),
      standing: {
        ...withActingConsort(baseState()).standing,
        xu_qinghuan: { ...withActingConsort(baseState()).standing.xu_qinghuan!, lifecycle: "deceased" },
      },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-10: 协理者被禁足中 → 拒绝", () => {
    const base = withActingConsort(baseState());
    const now = toGameTime(base.calendar);
    const state: GameState = {
      ...base,
      statusEffects: [
        ...base.statusEffects,
        {
          id: "status_xu_qinghuan_000001",
          kind: "confinement" as const,
          characterId: "xu_qinghuan",
          startTurn: base.calendar.dayIndex,
          endTurnExclusive: null,
          imposedAt: now,
          imposedBy: "emperor" as const,
        },
      ],
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-11: 协理者位分低于驸（fu, order 140）→ 拒绝", () => {
    const base = withActingConsort(baseState());
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        xu_qinghuan: { ...base.standing.xu_qinghuan!, rank: "chenghui" }, // order 134
      },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });
});

// ─── III. canAdministratorAdjustRank 目标校验 ────────────────────────────────

describe("canAdministratorAdjustRank — 目标校验", () => {
  it("RA-12: 目标生命周期 = deceased → 拒绝", () => {
    const base = withActingConsort(baseState());
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        wenya: { ...base.standing.wenya!, lifecycle: "deceased" },
      },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-13: 目标为凤后 → 拒绝", () => {
    const state = withActingConsort(baseState());
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "shen_zhibai", "guijun");
    expect(result.ok).toBe(false);
  });

  it("RA-14: 目标当前位分 >= 协理者位分 → 拒绝", () => {
    // 将 wenya 临时升为 jun（与 xu_qinghuan 同级）。
    const base = withActingConsort(baseState());
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        wenya: { ...base.standing.wenya!, rank: "jun" },
      },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });
});

// ─── IV. canAdministratorAdjustRank 新位分校验 ───────────────────────────────

describe("canAdministratorAdjustRank — 新位分校验", () => {
  it("RA-15: newRankId = fenghou → 拒绝", () => {
    const state = withActingConsort(baseState());
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fenghou");
    expect(result.ok).toBe(false);
  });

  it("RA-16: newRank.order >= 协理者 order → 拒绝（不能晋升到与自己同级）", () => {
    const state = withActingConsort(baseState()); // xu_qinghuan = jun(160)
    // fu(140) 低于 jun(160)，但 jun(160) == actor order，拒绝。
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "jun");
    expect(result.ok).toBe(false);
  });

  it("RA-17: 合法降位 —— 承徽→更衣，协理者 jun(160) → 通过", () => {
    const state = withActingConsort(baseState()); // wenya = chenghui(134), actor = jun(160)
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "gengyi"); // gengyi(50)
    expect(result.ok).toBe(true);
  });

  it("RA-18: 合法晋位 —— 承徽→驸，协理者 jun(160) → 通过", () => {
    const state = withActingConsort(baseState()); // wenya = chenghui(134), actor = jun(160)
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu"); // fu(140) < jun(160)
    expect(result.ok).toBe(true);
  });
});

// ─── V. funnel 层校验 ────────────────────────────────────────────────────────

describe("funnel — authority 校验", () => {
  it("RA-19: set_rank authority=harem_administrator/acting_consort 不符合条件 → validateEffects 返回错误", () => {
    const state = baseState(); // mode = empress，不是 acting_consort
    const errors = validateEffects(db, state, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "fu",
        authority: { kind: "harem_administrator", actorId: "xu_qinghuan", office: "acting_consort" as const },
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-20: set_rank authority=harem_administrator/acting_consort 满足全部条件 → validateEffects 无错，applyEffects 成功", () => {
    const state = withActingConsort(baseState()); // xu_qinghuan 协理，wenya=chenghui
    const errors = validateEffects(db, state, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "fu",
        authority: { kind: "harem_administrator", actorId: "xu_qinghuan", office: "acting_consort" as const },
      },
    ]);
    expect(errors).toHaveLength(0);

    const applied = applyEffects(db, state, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "fu",
        authority: { kind: "harem_administrator", actorId: "xu_qinghuan", office: "acting_consort" as const },
      },
    ]);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.standing["wenya"]?.rank).toBe("fu");
    }
  });
});

// ─── VI. canEmpressAdjustRank ────────────────────────────────────────────────

describe("canEmpressAdjustRank", () => {
  it("RA-21: haremAdmin 不是 empress 模式 → 拒绝", () => {
    const state = withActingConsort(baseState()); // mode = acting_consort
    const result = canEmpressAdjustRank(db, state, "shen_zhibai", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-22: actorId 不是当前凤后 → 拒绝", () => {
    const state = baseState(); // mode = empress
    const result = canEmpressAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-23: 凤后合法调整 chenghui→fu → 通过", () => {
    const state = baseState(); // mode = empress, shen_zhibai = 凤后
    const result = canEmpressAdjustRank(db, state, "shen_zhibai", "wenya", "fu");
    expect(result.ok).toBe(true);
  });

  it("RA-24: empress authority 在 set_rank effect 中 → funnel 校验通过", () => {
    const state = baseState(); // mode = empress
    const errors = validateEffects(db, state, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "fu",
        authority: { kind: "harem_administrator", actorId: "shen_zhibai", office: "empress" as const },
      },
    ]);
    expect(errors).toHaveLength(0);
  });
});

// ─── VII. authority 必填校验 ────────────────────────────────────────────────

describe("funnel — authority 必填校验（Blocking 3）", () => {
  it("RA-25: set_rank 无 authority → validateEffects 返回错误", () => {
    const state = baseState();
    // @ts-expect-error testing missing authority
    const errors = validateEffects(db, state, [{ type: "set_rank", char: "wenya", rank: "fu" }]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-26: set_title 无 authority → validateEffects 返回错误", () => {
    const state = baseState();
    // @ts-expect-error testing missing authority
    const errors = validateEffects(db, state, [{ type: "set_title", char: "wenya", title: "婉" }]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-27: remove_title 无 authority → validateEffects 返回错误", () => {
    const state = baseState();
    // @ts-expect-error testing missing authority
    const errors = validateEffects(db, state, [{ type: "remove_title", char: "wenya" }]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-28: set_rank with sovereign/player authority → 校验通过", () => {
    const state = baseState();
    const errors = validateEffects(db, state, [
      { type: "set_rank", char: "wenya", rank: "fu", authority: { kind: "sovereign", actorId: "player" } },
    ]);
    expect(errors).toHaveLength(0);
  });
});

// ─── VIII. GameStore chronicle 持久化 ──────────────────────────────────────

describe("GameStore — chronicle persistence（Blocking 1）", () => {
  it("GS-01: 成功命令 → state.chronicle 有 rank_changed 条目，actorId 匹配", () => {
    const store = new GameStore();
    store.loadState(withActingConsort(baseState()));
    const state = store.getState();
    const chronicleLenBefore = state.chronicle.length;
    const result = store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "fu" },
    });
    expect(result.ok).toBe(true);
    const after = store.getState();
    expect(after.chronicle.length).toBeGreaterThan(chronicleLenBefore);
    const entry = after.chronicle.find((e) => e.type === "rank_changed");
    expect(entry).toBeDefined();
  });

  it("GS-02: chronicle 条目 payload.actorId 为代理侍君 charId，不是 player", () => {
    const store = new GameStore();
    store.loadState(withActingConsort(baseState()));
    const result = store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "fu" },
    });
    expect(result.ok).toBe(true);
    const after = store.getState();
    const entry = after.chronicle.find((e) => e.type === "rank_changed");
    expect((entry?.payload as { actorId?: string })?.actorId).toBe("xu_qinghuan");
  });

  it("GS-03: 无效命令（校验拒绝）→ state 不变，chronicle 未增加", () => {
    const store = new GameStore();
    store.loadState(baseState()); // mode = empress，canAdministratorAdjustRank 会拒绝
    const before = store.getState();
    const chronicleLenBefore = before.chronicle.length;
    const result = store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "fu" },
    });
    expect(result.ok).toBe(false);
    expect(store.getState().chronicle.length).toBe(chronicleLenBefore);
    expect(store.getState().standing["wenya"]?.rank).toBe(before.standing["wenya"]?.rank);
  });
});

describe("GameStore — single emit per command", () => {
  it("成功命令只触发一次 emit", () => {
    const store = new GameStore();
    store.loadState(withActingConsort(baseState()));
    let emitCount = 0;
    store.subscribe(() => { emitCount++; });
    store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "fu" },
    });
    expect(emitCount).toBe(1);
  });
});
