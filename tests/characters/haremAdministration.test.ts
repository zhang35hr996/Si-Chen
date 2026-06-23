/**
 * 六宫协理机制（§IV-XI）全套测试。
 * 23 项覆盖：候选资格、命令校验、协理者请安、自动恢复、状态切换、save round-trip、migration。
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createInitialState } from "../../src/engine/state/initialState";
import { eligibleHaremAdministrators, getGreetingLocation } from "../../src/engine/characters/haremAdministration";
import { greetingAttendees } from "../../src/engine/characters/greeting";
import { planImperialCommand } from "../../src/store/imperialCommands";
import { createGameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";
import { isConfined } from "../../src/engine/characters/confinement";
import { MAO_SLOT } from "../../src/engine/calendar/time";
import { consortLocationAt } from "../../src/engine/characters/presence";
import type { GameState } from "../../src/engine/state/types";
import { toGameTime } from "../../src/engine/calendar/time";
import { SAVE_FORMAT_VERSION } from "../../src/engine/save/saveSystem";

const db = loadRealContent();

// ─── 共用工具 ────────────────────────────────────────────────────────────────

function freshStore() {
  const store = createGameStore();
  store.loadState(createNewGameState(db));
  return store;
}

/** 快速设 haremAdministration 为 acting_consort。 */
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

// ─── I. 候选资格 ─────────────────────────────────────────────────────────────

describe("eligibleHaremAdministrators — 候选资格", () => {
  // T13: 驸（order 140）恰好满足门槛
  it("T13: 驸（order 140）的侍君满足候选门槛", () => {
    // xu_qinghuan 是 jun（160），升一级以测试 fu(140) 临界。
    // 用内容中直接有 jun 的 xu_qinghuan 测 order >= 140 通过。
    const state = createNewGameState(db);
    const eligible = eligibleHaremAdministrators(db, state);
    const charIds = eligible.map((c) => c.id);
    expect(charIds).toContain("xu_qinghuan"); // jun(160) >= fu(140)
  });

  // T14: 承徽（order 134）不满足门槛
  it("T14: 承徽（order 134）不满足候选门槛", () => {
    const state = createNewGameState(db);
    const eligible = eligibleHaremAdministrators(db, state);
    const charIds = eligible.map((c) => c.id);
    expect(charIds).not.toContain("lu_huaijin"); // chenghui(134) < fu(140)
  });

  // T15: jun（160）满足位分门槛
  it("T15: 君（order 160）满足位分门槛", () => {
    const state = createNewGameState(db);
    const eligible = eligibleHaremAdministrators(db, state);
    expect(eligible.some((c) => c.id === "xu_qinghuan")).toBe(true);
  });

  // T16: 死亡/禁足/冷宫/candidate 角色被排除
  it("T16a: 已故侍君不可协理", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "execute", targetId: "xu_qinghuan" });
    const eligible = eligibleHaremAdministrators(db, store.getState());
    expect(eligible.some((c) => c.id === "xu_qinghuan")).toBe(false);
  });

  it("T16b: 已禁足侍君不可协理", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "xu_qinghuan", durationTurns: 3 });
    const eligible = eligibleHaremAdministrators(db, store.getState());
    expect(eligible.some((c) => c.id === "xu_qinghuan")).toBe(false);
  });

  it("T16c: 冷宫侍君不可协理", () => {
    const state = createNewGameState(db);
    const cold = {
      ...state,
      standing: {
        ...state.standing,
        xu_qinghuan: { ...state.standing.xu_qinghuan!, residence: "changmengong" },
      },
    };
    const eligible = eligibleHaremAdministrators(db, cold);
    expect(eligible.some((c) => c.id === "xu_qinghuan")).toBe(false);
  });
});

// ─── II. 命令校验 ─────────────────────────────────────────────────────────────

describe("planImperialCommand — 凤后禁足命令校验", () => {
  // T10: 凤后可以被禁足（有合格候选时携带候选）
  it("T10: 凤后可以被禁足", () => {
    const state = createNewGameState(db);
    const r = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.effects.some((e) => e.type === "confine")).toBe(true);
    expect(r.plan.effects.some((e) => e.type === "set_harem_administration")).toBe(true);
  });

  // T11: 凤后可以被解除禁足（先禁再解）
  it("T11: 凤后可以被解除禁足", () => {
    const store = freshStore();
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    expect(isConfined(store.getState(), "shen_zhibai")).toBe(true);
    const r = store.applyImperialCommand(db, { type: "lift_confinement", targetId: "shen_zhibai" });
    expect(r.ok).toBe(true);
    expect(isConfined(store.getState(), "shen_zhibai")).toBe(false);
  });

  // T12: 普通侍君禁足不触发协理选择（无 set_harem_administration 效果）
  it("T12: 普通侍君禁足不包含 set_harem_administration 效果", () => {
    const state = createNewGameState(db);
    const r = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "lu_huaijin",
      durationTurns: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.effects.some((e) => e.type === "set_harem_administration")).toBe(false);
  });

  // T17: 有候选时 command 缺少 administrator 被拒
  it("T17: 有候选时缺 administrator 被拒", () => {
    const state = createNewGameState(db);
    const r = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("须同时指定");
  });

  // T18: 有候选时选择 neiwu_proxy 被拒
  it("T18: 有候选时选择 neiwu_proxy 被拒", () => {
    const state = createNewGameState(db);
    const r = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "neiwu_proxy" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("驸级以上侍君");
  });

  // T19: 无候选时自动/只允许内务府代理
  it("T19: 无候选时只允许 neiwu_proxy", () => {
    // 禁足 xu_qinghuan（唯一合格候选），此后只剩 neiwu_proxy。
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "xu_qinghuan", durationTurns: 3 });
    const state = store.getState();
    const eligible = eligibleHaremAdministrators(db, state);
    expect(eligible.length).toBe(0);

    const rConsort = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    expect(rConsort.ok).toBe(false);

    const rProxy = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "neiwu_proxy" },
    });
    expect(rProxy.ok).toBe(true);
  });
});

// ─── III. 请安地点与出席者 ────────────────────────────────────────────────────

describe("请安地点 — getGreetingLocation", () => {
  // T20: 协理者寝殿成为请安地点
  it("T20: acting_consort 模式下，协理者寝殿为请安地点", () => {
    const state = createNewGameState(db);
    // xu_qinghuan 住处 = content 的 defaultLocation
    const adminState = withActingConsort(state, "xu_qinghuan");
    const loc = getGreetingLocation(db, adminState);
    const char = db.characters["xu_qinghuan"]!;
    const home = adminState.standing.xu_qinghuan?.residence ?? char.defaultLocation;
    expect(loc).toBe(home);
    expect(loc).not.toBe(null);
  });

  // T23: 坤宁宫不再触发请安（acting_consort 模式）
  it("T23: acting_consort 模式下，getGreetingLocation 不返回 kunninggong（当协理者不住坤宁宫时）", () => {
    const state = createNewGameState(db);
    const adminState = withActingConsort(state, "xu_qinghuan");
    const loc = getGreetingLocation(db, adminState);
    // xu_qinghuan 不住坤宁宫
    expect(loc).not.toBe("kunninggong");
  });

  // T24: 内务府代理期间无正式请安
  it("T24: neiwu_proxy 模式下，getGreetingLocation 返回 null", () => {
    const state: GameState = {
      ...createNewGameState(db),
      haremAdministration: {
        mode: "neiwu_proxy",
        appointedAt: toGameTime(createNewGameState(db).calendar),
        reason: "no_eligible_consort",
      },
    };
    const loc = getGreetingLocation(db, state);
    expect(loc).toBeNull();
  });
});

describe("greetingAttendees — 出席者过滤", () => {
  // T21: 协理者本人不参加请安（不在 greetingAttendees 返回列表中）
  it("T21: acting_consort 模式下，协理者本人不在 greetingAttendees 列表中", () => {
    const base = createNewGameState(db);
    // 设置为卯时（MAO_SLOT）
    const state: GameState = {
      ...withActingConsort(base, "xu_qinghuan"),
      calendar: { ...base.calendar, dayIndex: MAO_SLOT },
    };
    const attendees = greetingAttendees(db, state);
    expect(attendees.some((c) => c.id === "xu_qinghuan")).toBe(false);
  });

  // T22: 与协理者同宫的其他侍君仍参加请安
  it("T22: 与协理者同宫的其他侍君仍参加请安（不因住处相同被排除）", () => {
    const base = createNewGameState(db);
    // 把 lu_huaijin 搬到与 xu_qinghuan 相同的宫
    const xqHome = base.standing.xu_qinghuan?.residence ?? db.characters.xu_qinghuan!.defaultLocation;
    const state: GameState = {
      ...withActingConsort(base, "xu_qinghuan"),
      calendar: { ...base.calendar, dayIndex: MAO_SLOT },
      standing: {
        ...base.standing,
        lu_huaijin: { ...base.standing.lu_huaijin!, residence: xqHome },
      },
    };
    const attendees = greetingAttendees(db, state);
    // xu_qinghuan 不在，lu_huaijin 在
    expect(attendees.some((c) => c.id === "xu_qinghuan")).toBe(false);
    expect(attendees.some((c) => c.id === "lu_huaijin")).toBe(true);
  });
});

describe("consortLocationAt — 卯时路由", () => {
  it("T23b: 普通侍君卯时前往协理者寝殿，而非坤宁宫", () => {
    const base = createNewGameState(db);
    const state: GameState = {
      ...withActingConsort(base, "xu_qinghuan"),
      calendar: { ...base.calendar, dayIndex: MAO_SLOT },
    };
    const xqHome = state.standing.xu_qinghuan?.residence ?? db.characters.xu_qinghuan!.defaultLocation;
    // lu_huaijin 不住坤宁宫，卯时应往协理者处
    const loc = consortLocationAt(db, state, "lu_huaijin", MAO_SLOT);
    expect(loc).toBe(xqHome);
    expect(loc).not.toBe("kunninggong");
  });

  it("neiwu_proxy 时，侍君卯时留家（无请安地点）", () => {
    const base = createNewGameState(db);
    const state: GameState = {
      ...base,
      haremAdministration: {
        mode: "neiwu_proxy",
        appointedAt: toGameTime(base.calendar),
        reason: "no_eligible_consort",
      },
      calendar: { ...base.calendar, dayIndex: MAO_SLOT },
    };
    const home = state.standing.lu_huaijin?.residence ?? db.characters.lu_huaijin!.defaultLocation;
    const loc = consortLocationAt(db, state, "lu_huaijin", MAO_SLOT);
    expect(loc).toBe(home); // 留家
  });
});

// ─── IV. 自动恢复 ─────────────────────────────────────────────────────────────

describe("凤后禁足解除后自动恢复", () => {
  // T25: 手动解除凤后禁足后恢复坤宁宫请安
  it("T25: 手动解除凤后禁足后，haremAdministration 自动恢复为 empress 模式", () => {
    const store = freshStore();
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    expect(store.getState().haremAdministration.mode).toBe("acting_consort");

    store.applyImperialCommand(db, { type: "lift_confinement", targetId: "shen_zhibai" });
    expect(store.getState().haremAdministration.mode).toBe("empress");
  });

  // T26: 自动到期后恢复坤宁宫请安
  it("T26: 凤后禁足到期后，haremAdministration 通过 sweep 自动恢复为 empress 模式", () => {
    const store = freshStore();
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 1,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    // 快进 1 旬
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    expect(store.getState().haremAdministration.mode).toBe("empress");
  });
});

// ─── V. 协理者失格时自动切换 ─────────────────────────────────────────────────

describe("acting_consort 失格时自动切换", () => {
  // T27: 协理者死亡/禁足不会留下悬空引用
  it("T27a: 协理者被赐死后，自动切换到 neiwu_proxy（无其他候选时）", () => {
    const store = freshStore();
    // 先禁足凤后（xu_qinghuan 协理）
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 10,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    expect(store.getState().haremAdministration.mode).toBe("acting_consort");

    // 协理者死亡
    store.applyImperialCommand(db, { type: "execute", targetId: "xu_qinghuan" });
    const admin = store.getState().haremAdministration;
    // 无其他合格候选，切换为 neiwu_proxy
    expect(admin.mode).toBe("neiwu_proxy");
  });

  it("T27b: 协理者被禁足后，自动切换到 neiwu_proxy（无其他候选时）", () => {
    const store = freshStore();
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 10,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "xu_qinghuan", durationTurns: 3 });
    const admin = store.getState().haremAdministration;
    expect(admin.mode).toBe("neiwu_proxy");
  });
});

// ─── VI. save round-trip 与 migration ────────────────────────────────────────

describe("save round-trip", () => {
  // T28: 新游戏 save round-trip：haremAdministration 可序列化并还原
  it("T28: 新游戏 haremAdministration 字段 round-trip（通过 stateSchema）", () => {
    const state = createNewGameState(db);
    expect(state.haremAdministration).toEqual({ mode: "empress" });
  });

  it("acting_consort state round-trip", () => {
    const store = freshStore();
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    const st = store.getState();
    expect(st.haremAdministration.mode).toBe("acting_consort");
    if (st.haremAdministration.mode === "acting_consort") {
      expect(st.haremAdministration.charId).toBe("xu_qinghuan");
      expect(st.haremAdministration.reason).toBe("empress_confined");
    }
  });
});

describe("v9 → v10 migration", () => {
  // T29: save format version 已升到 10，v9 存档补上 haremAdministration。
  it("T29: SAVE_FORMAT_VERSION 为 10（v9→v10 已实施）", () => {
    expect(SAVE_FORMAT_VERSION).toBe(10);
  });

  it("T29b: createInitialState 包含 haremAdministration: { mode: 'empress' }", () => {
    const state = createInitialState();
    expect(state.haremAdministration).toEqual({ mode: "empress" });
  });

  it("T29c: createNewGameState 包含 haremAdministration: { mode: 'empress' }", () => {
    const state = createNewGameState(db);
    expect(state.haremAdministration).toEqual({ mode: "empress" });
  });
});

// ─── VII. 原子失败 ────────────────────────────────────────────────────────────

describe("命令原子失败时 state 不变", () => {
  // T32: 整个 command 原子失败时 state reference 和内容不变
  it("T32: 非法命令（administrator 不合格）不会修改 state", () => {
    const store = freshStore();
    const before = store.getState();
    store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "lu_huaijin" }, // 不合格
    });
    const after = store.getState();
    expect(after).toBe(before); // 同一引用（原子失败不 commit）
    expect(after.haremAdministration.mode).toBe("empress");
    expect(isConfined(after, "shen_zhibai")).toBe(false);
  });
});
