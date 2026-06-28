/**
 * 六宫行政位分处分权测试（42 项）
 *
 * 测试 getHaremRankAuthority() 与 canAdministratorAdjustRank()，
 * 以及 funnel 层对 set_rank authority 的校验。
 *
 * 测试环境角色：
 *   shen_zhibai — 皇后（huanghou，kunninggong）
 *   xu_qinghuan — 驸（fu, order 176，xianfugong）  ← 代理侍君
 *   wenya       — 承徽（chenghui, order 156，changmengong）← 默认高于贵人（116）
 *   lu_huaijin  — 承徽（chenghui, order 156，zhongcui_gong）← 目标
 *
 * 贵人边界（RA-29..RA-33）：
 *   贵人及以上（order >= guiren.order = 116）须陛下亲旨；主理权只覆盖贵人以下。
 *   新位分上限为贵人（order <= guiren.order），不可晋至贵人以上。
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  getHaremRankAuthority,
  canAdministratorAdjustRank,
  canEmpressAdjustRank,
} from "../../src/engine/characters/haremRankAuthority";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { loadRealContent } from "../helpers/contentFixture";
import { toGameTime } from "../../src/engine/calendar/time";
import { GameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();

// ─── 共用工具 ────────────────────────────────────────────────────────────────

function baseState(): GameState {
  // shen_zhibai is now event_only; inject her as empress (replacing the generated empress)
  let s = createNewGameState(db);
  const genEmpressId = Object.keys(s.standing).find((id) => s.standing[id]!.rank === "huanghou");
  if (genEmpressId) {
    const { [genEmpressId]: _st, ...restSt } = s.standing;
    const { [genEmpressId]: _gc, ...restGc } = s.generatedConsorts;
    s = { ...s, standing: restSt, generatedConsorts: restGc };
  }
  s = withConsort(s, db, "shen_zhibai");
  return withConsort(withConsort(s, db, "xu_qinghuan"), db, "wenya");
}

/** 皇后禁足状态效果 */
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

/** 皇后禁足 + haremAdministration 设为 xu_qinghuan 代理 */
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

/**
 * 将 wenya 的位分设为常在（changzai, order 84），使其落在贵人边界以下，
 * 成为主理权合法可调整的目标。
 */
function withWenyaAtChangzai(state: GameState): GameState {
  return {
    ...state,
    standing: { ...state.standing, wenya: { ...state.standing.wenya!, rank: "changzai" } },
  };
}

// ─── I. getHaremRankAuthority ─────────────────────────────────────────────────

describe("getHaremRankAuthority", () => {
  it("RA-01b: empress 模式 → harem_administrator/<皇后charId>，maxTargetOrder = guiren.order - 1", () => {
    const state = baseState(); // haremAdmin.mode = "empress"
    const auth = getHaremRankAuthority(db, state);
    expect(auth.kind).toBe("harem_administrator");
    if (auth.kind === "harem_administrator") {
      // 皇后 charId 应为 shen_zhibai（新游戏默认皇后）
      expect(auth.actorId).toBe("shen_zhibai");
      // 贵人边界：maxTargetOrder = guiren.order - 1（不再是 huanghou.order - 1）
      expect(auth.maxTargetOrder).toBe((db.ranks["guiren"]?.order ?? 116) - 1);
    }
  });

  it("RA-02: acting_consort 模式 → harem_administrator，maxTargetOrder = min(actorOrder-1, guiren.order-1)", () => {
    const state = withActingConsort(baseState());
    const auth = getHaremRankAuthority(db, state);
    expect(auth.kind).toBe("harem_administrator");
    if (auth.kind === "harem_administrator") {
      expect(auth.actorId).toBe("xu_qinghuan");
      // fu(176) - 1 = 175，但贵人边界收紧至 guiren.order - 1
      const fuOrder = db.ranks["fu"]?.order ?? 176;
      const guirenOrder = db.ranks["guiren"]?.order ?? 116;
      expect(auth.maxTargetOrder).toBe(Math.min(fuOrder - 1, guirenOrder - 1));
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

  it("RA-08: acting_consort 模式不要求皇后禁足（PUNISH-3A imperial_deprivation 路径）→ 允许", () => {
    // PUNISH-3A 后：权威判据为 haremAdministration.mode，不再要求皇后禁足。
    // imperial_deprivation/empress_illness 委任均不伴随皇后禁足。
    // wenya 必须在贵人以下（常在 changzai，order 84）才能被主理权覆盖。
    const base: GameState = {
      ...baseState(),
      haremAdministration: {
        mode: "acting_consort",
        charId: "xu_qinghuan",
        appointedAt: toGameTime(baseState().calendar),
        reason: "imperial_deprivation",
      },
    };
    const state = withWenyaAtChangzai(base);
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "guiren");
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
        xu_qinghuan: { ...base.standing.xu_qinghuan!, rank: "chenghui" }, // order 156
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

  it("RA-13: 目标为皇后 → 拒绝", () => {
    const state = withActingConsort(baseState());
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "shen_zhibai", "guifu");
    expect(result.ok).toBe(false);
  });

  it("RA-14: 目标当前位分 >= 协理者位分 → 拒绝", () => {
    // 将 wenya 临时升为 fu（与 xu_qinghuan 同级）。
    const base = withActingConsort(baseState());
    const state: GameState = {
      ...base,
      standing: {
        ...base.standing,
        wenya: { ...base.standing.wenya!, rank: "fu" },
      },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });
});

// ─── IV. canAdministratorAdjustRank 新位分校验 ───────────────────────────────

describe("canAdministratorAdjustRank — 新位分校验", () => {
  it("RA-15: newRankId = huanghou → 拒绝", () => {
    const state = withActingConsort(baseState());
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "huanghou");
    expect(result.ok).toBe(false);
  });

  it("RA-16: newRank.order >= 协理者 order → 拒绝（不能晋升到与自己同级）", () => {
    const state = withActingConsort(baseState()); // xu_qinghuan = fu(176)
    // fu(176) == actor order，拒绝同级。
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-17: 合法降位 —— 常在→更衣，协理者 fu(176) → 通过", () => {
    // wenya 必须在贵人以下（常在 changzai order 84），降至更衣（gengyi order 68）合法。
    const state = withWenyaAtChangzai(withActingConsort(baseState()));
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "gengyi");
    expect(result.ok).toBe(true);
  });

  it("RA-18: 合法晋位 —— 常在→贵人（上限），协理者 fu(176) → 通过", () => {
    // wenya 在常在（changzai order 84），晋至贵人（guiren order 116）正好触顶，合法。
    const state = withWenyaAtChangzai(withActingConsort(baseState()));
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "guiren");
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
    // wenya 在常在（changzai order 84），晋至贵人（guiren order 116）合法。
    const base = withWenyaAtChangzai(withActingConsort(baseState()));
    const errors = validateEffects(db, base, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "guiren",
        authority: { kind: "harem_administrator", actorId: "xu_qinghuan", office: "acting_consort" as const },
      },
    ]);
    expect(errors).toHaveLength(0);

    const applied = applyEffects(db, base, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "guiren",
        authority: { kind: "harem_administrator", actorId: "xu_qinghuan", office: "acting_consort" as const },
      },
    ]);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.standing["wenya"]?.rank).toBe("guiren");
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

  it("RA-22: actorId 不是当前皇后 → 拒绝", () => {
    const state = baseState(); // mode = empress
    const result = canEmpressAdjustRank(db, state, "xu_qinghuan", "wenya", "fu");
    expect(result.ok).toBe(false);
  });

  it("RA-23: 皇后合法调整 常在→贵人（上限）→ 通过", () => {
    // wenya 在常在（changzai order 84），晋至贵人（guiren order 116）是主理权上限。
    const state = withWenyaAtChangzai(baseState());
    const result = canEmpressAdjustRank(db, state, "shen_zhibai", "wenya", "guiren");
    expect(result.ok).toBe(true);
  });

  it("RA-24: empress authority 在 set_rank effect 中 → funnel 校验通过", () => {
    // wenya 在常在，晋至贵人合法。
    const state = withWenyaAtChangzai(baseState());
    const errors = validateEffects(db, state, [
      {
        type: "set_rank",
        char: "wenya",
        rank: "guiren",
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
    store.loadState(withWenyaAtChangzai(withActingConsort(baseState())));
    const state = store.getState();
    const chronicleLenBefore = state.chronicle.length;
    const result = store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "guiren" },
    });
    expect(result.ok).toBe(true);
    const after = store.getState();
    expect(after.chronicle.length).toBeGreaterThan(chronicleLenBefore);
    const entry = after.chronicle.find((e) => e.type === "rank_changed");
    expect(entry).toBeDefined();
  });

  it("GS-02: chronicle 条目 payload.actorId 为代理侍君 charId，不是 player", () => {
    const store = new GameStore();
    store.loadState(withWenyaAtChangzai(withActingConsort(baseState())));
    const result = store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "guiren" },
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
    store.loadState(withWenyaAtChangzai(withActingConsort(baseState())));
    let emitCount = 0;
    store.subscribe(() => { emitCount++; });
    store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_rank", rank: "guiren" },
    });
    expect(emitCount).toBe(1);
  });
});

// ─── IX. 封号操作被主理权拒绝 ──────────────────────────────────────────────────

describe("封号操作被主理权拒绝（RA-34..RA-38）— 封号须陛下亲旨", () => {
  it("RA-34: 皇后 set_title → funnel 拒绝（harem_administrator 无封号权）", () => {
    // wenya 在常在（低于贵人），皇后仍无权赐予封号。
    const state = withWenyaAtChangzai(baseState());
    const errors = validateEffects(db, state, [
      {
        type: "set_title",
        char: "wenya",
        title: "婉",
        authority: { kind: "harem_administrator", actorId: "shen_zhibai", office: "empress" as const },
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-35: 皇后 remove_title → funnel 拒绝（贵人以上目标亦如此）", () => {
    // wenya 在承徽（贵人以上），皇后尝试褫夺封号 → 拒绝。
    const state = baseState(); // wenya 默认在承徽 (chenghui, order 156 > guiren 116)
    const errors = validateEffects(db, state, [
      {
        type: "remove_title",
        char: "wenya",
        authority: { kind: "harem_administrator", actorId: "shen_zhibai", office: "empress" as const },
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-36: 协理者 set_title → funnel 拒绝（harem_administrator 无封号权）", () => {
    const state = withWenyaAtChangzai(withActingConsort(baseState()));
    const errors = validateEffects(db, state, [
      {
        type: "set_title",
        char: "wenya",
        title: "婉",
        authority: { kind: "harem_administrator", actorId: "xu_qinghuan", office: "acting_consort" as const },
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("RA-37: sovereign set_title → funnel 通过（皇帝封号权不受限）", () => {
    const state = baseState();
    const errors = validateEffects(db, state, [
      {
        type: "set_title",
        char: "wenya",
        title: "婉",
        authority: { kind: "sovereign", actorId: "player" },
      },
    ]);
    expect(errors).toHaveLength(0);
  });

  it("RA-38: applyHaremAdminRankCommand set_title → 命令层拒绝，chronicle 不变", () => {
    const store = new GameStore();
    store.loadState(withWenyaAtChangzai(withActingConsort(baseState())));
    const before = store.getState();
    const chronicleLenBefore = before.chronicle.length;
    const result = store.applyHaremAdminRankCommand(db, {
      type: "harem_admin_rank_change",
      actorId: "xu_qinghuan",
      targetId: "wenya",
      request: { kind: "set_title", title: "婉" },
    });
    expect(result.ok).toBe(false);
    expect(store.getState().chronicle.length).toBe(chronicleLenBefore);
  });
});

// ─── X. 贵人边界 ─────────────────────────────────────────────────────────────

describe("贵人边界（RA-29..RA-33）— 位分变更主理权只覆盖贵人以下", () => {
  it("RA-29: canAdministratorAdjustRank — 目标在贵人（order 116）→ 拒绝，即使协理者 fu 更高", () => {
    // 贵人本身不可被主理权调整（须陛下亲旨）。
    const base = withActingConsort(baseState());
    const state: GameState = {
      ...base,
      standing: { ...base.standing, wenya: { ...base.standing.wenya!, rank: "guiren" } },
    };
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "changzai");
    expect(result.ok).toBe(false);
  });

  it("RA-30: canEmpressAdjustRank — 目标在承徽（order 156，贵人以上）→ 拒绝", () => {
    // wenya 默认为承徽（order 156 >= guiren order 116）。
    const state = baseState();
    const result = canEmpressAdjustRank(db, state, "shen_zhibai", "wenya", "changzai");
    expect(result.ok).toBe(false);
  });

  it("RA-31: canEmpressAdjustRank — 目标在常在，新位分为贵驸（order 188）→ 拒绝（超出贵人上限）", () => {
    const state = withWenyaAtChangzai(baseState());
    const result = canEmpressAdjustRank(db, state, "shen_zhibai", "wenya", "guifu");
    expect(result.ok).toBe(false);
  });

  it("RA-32: canEmpressAdjustRank — 目标在常在，新位分为贵人（order 116）→ 通过（正好触顶）", () => {
    const state = withWenyaAtChangzai(baseState());
    const result = canEmpressAdjustRank(db, state, "shen_zhibai", "wenya", "guiren");
    expect(result.ok).toBe(true);
  });

  it("RA-33: canAdministratorAdjustRank — 目标在常在，新位分为贵人（order 116）→ 通过", () => {
    const state = withWenyaAtChangzai(withActingConsort(baseState()));
    const result = canAdministratorAdjustRank(db, state, "xu_qinghuan", "wenya", "guiren");
    expect(result.ok).toBe(true);
  });
});
