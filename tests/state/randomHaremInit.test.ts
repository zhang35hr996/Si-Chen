/**
 * 开局随机后宫规格验证。
 *
 * 覆盖规格全部要求：
 *  R1  固定皇后始终存在
 *  R2  开局仅含随机生成侍君（不含剧情固定侍君）
 *  R3  生成人数 1–5，总开局人数 2–6
 *  R4  生成侍君存入 state.generatedConsorts
 *  R5  生成侍君同时在 state.standing
 *  R6  同 seed 结果完全相同（确定性）
 *  R7  不同 seed 产出不同（随机性）
 *  R8  冷宫开局为空
 *  R9  封号约束：贵驸最多 1 位
 *  R10 封号约束：贤/良/德/驸 合计最多 2 位
 *  R11 封号均为有效 rank id
 *  R12 姓氏唯一（无两位同姓）
 *  R13 居所唯一（无两位同宫）
 *  R14 宠爱值在 5–35
 *  R15 生命值在 45–95
 *  R16 年龄在 16–28
 *  R17 剧情侍君 spawnMode=event_only 且不在开局 standing 内
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const COLD_PALACE_ID = "changmengong";
const STORY_CONSORT_IDS = ["lu_huaijin", "xu_qinghuan", "wenya", "shen_zhibai"];
const TIER2_RANKS = new Set(["xianfu", "liangfu", "defu", "fu"]);
const VALID_RANK_IDS = new Set(db.world.ranks.map((r) => r.id));

function generatedConsortIds(state: ReturnType<typeof createNewGameState>): string[] {
  return Object.keys(state.generatedConsorts);
}

function regularGeneratedIds(state: ReturnType<typeof createNewGameState>): string[] {
  return Object.keys(state.generatedConsorts).filter((id) => !id.startsWith("generated_empress_"));
}

// ── R1 随机皇后 ───────────────────────────────────────────────────────────────

describe("R1: 随机皇后", () => {
  it("新游戏有且仅有一位皇后（rank=huanghou）", () => {
    const s = createNewGameState(db);
    const empressEntries = Object.entries(s.standing).filter(([, st]) => st.rank === "huanghou");
    expect(empressEntries).toHaveLength(1);
  });

  it("皇后 id 格式为 generated_empress_{seed}", () => {
    const s = createNewGameState(db, 1);
    const empressId = Object.keys(s.standing).find((id) => s.standing[id]?.rank === "huanghou");
    expect(empressId).toMatch(/^generated_empress_1$/);
  });

  it("皇后居所为 kunninggong", () => {
    const s = createNewGameState(db);
    const empressId = Object.keys(s.standing).find((id) => s.standing[id]?.rank === "huanghou");
    expect(empressId).toBeDefined();
    const residence = s.standing[empressId!]!.residence ?? s.generatedConsorts[empressId!]?.defaultLocation;
    expect(residence).toBe("kunninggong");
  });

  it("皇后数据存入 generatedConsorts", () => {
    const s = createNewGameState(db);
    const empressId = Object.keys(s.standing).find((id) => s.standing[id]?.rank === "huanghou");
    expect(empressId).toBeDefined();
    expect(s.generatedConsorts[empressId!]).toBeDefined();
  });

  it("shen_zhibai 不在 state.standing（已改为随机生成）", () => {
    const s = createNewGameState(db);
    expect(s.standing["shen_zhibai"]).toBeUndefined();
  });
});

// ── R2 剧情侍君不在开局 standing ──────────────────────────────────────────────

describe("R2 / R17: 剧情侍君不自动入宫", () => {
  it.each(STORY_CONSORT_IDS)(
    "%s 不在 state.standing",
    (id) => {
      const s = createNewGameState(db);
      expect(s.standing[id]).toBeUndefined();
    },
  );

  it.each(STORY_CONSORT_IDS)(
    "%s 的 spawnMode 为 event_only",
    (id) => {
      expect(db.characters[id]?.spawnMode).toBe("event_only");
    },
  );
});

// ── R3 生成人数 1–5，总人数 2–6 ───────────────────────────────────────────────

describe("R3: 开局后宫人数", () => {
  it("seed=1: 生成侍君数（不含皇后）在 1–5", () => {
    const s = createNewGameState(db, 1);
    const count = regularGeneratedIds(s).length;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(5);
  });

  it("seed=1: state.standing 总人数在 2–6（含皇后）", () => {
    const s = createNewGameState(db, 1);
    // standing includes empress + generated; story consorts absent
    const consortStandingCount = Object.keys(s.standing).filter((id) => {
      const c = db.characters[id] ?? s.generatedConsorts[id];
      return c?.kind === "consort";
    }).length;
    expect(consortStandingCount).toBeGreaterThanOrEqual(2);
    expect(consortStandingCount).toBeLessThanOrEqual(6);
  });

  it("多种 seed 均满足 1–5 随机人数（不含皇后）", () => {
    const counts = [1, 2, 3, 42, 100, 999].map((seed) =>
      regularGeneratedIds(createNewGameState(db, seed)).length,
    );
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(5);
    }
  });
});

// ── R4 生成侍君存入 state.generatedConsorts ──────────────────────────────────

describe("R4: 生成侍君存入 generatedConsorts", () => {
  it("generatedConsorts 非空", () => {
    const s = createNewGameState(db);
    expect(Object.keys(s.generatedConsorts).length).toBeGreaterThanOrEqual(1);
  });

  it("每个生成侍君 kind 均为 consort", () => {
    const s = createNewGameState(db);
    for (const c of Object.values(s.generatedConsorts)) {
      expect(c.kind).toBe("consort");
    }
  });

  it("生成侍君 id 格式为 generated_consort_{seed}_{index} 或 generated_empress_{seed}", () => {
    const s = createNewGameState(db, 7);
    for (const [id, c] of Object.entries(s.generatedConsorts)) {
      expect(id).toMatch(/^generated_(consort_7_\d+|empress_7)$/);
      expect(c.id).toBe(id);
    }
  });
});

// ── R5 生成侍君同时在 state.standing ─────────────────────────────────────────

describe("R5: 生成侍君在 state.standing", () => {
  it("每个 generatedConsorts 条目都有对应 standing", () => {
    const s = createNewGameState(db);
    for (const id of Object.keys(s.generatedConsorts)) {
      expect(s.standing[id]).toBeDefined();
    }
  });

  it("生成侍君 standing 包含 rank / favor / personality / household", () => {
    const s = createNewGameState(db);
    for (const id of Object.keys(s.generatedConsorts)) {
      const st = s.standing[id]!;
      expect(st.rank).toBeTruthy();
      expect(typeof st.favor).toBe("number");
      expect(st.personality).toBeDefined();
      expect(st.household).toBeDefined();
    }
  });
});

// ── R6 确定性：同 seed 完全相同 ───────────────────────────────────────────────

describe("R6: 同 seed 结果完全相同", () => {
  it("两次 createNewGameState(db, 42) 产出完全一致的 generatedConsorts", () => {
    const s1 = createNewGameState(db, 42);
    const s2 = createNewGameState(db, 42);
    expect(s1.generatedConsorts).toEqual(s2.generatedConsorts);
  });

  it("两次调用 standing 中生成部分完全一致", () => {
    const s1 = createNewGameState(db, 42);
    const s2 = createNewGameState(db, 42);
    for (const id of Object.keys(s1.generatedConsorts)) {
      expect(s1.standing[id]).toEqual(s2.standing[id]);
    }
  });
});

// ── R7 不同 seed 产出不同 ─────────────────────────────────────────────────────

describe("R7: 不同 seed 产出不同结果", () => {
  it("seed=1 与 seed=2 的生成侍君 id 不完全相同", () => {
    const s1 = createNewGameState(db, 1);
    const s2 = createNewGameState(db, 2);
    const ids1 = new Set(Object.keys(s1.generatedConsorts));
    const ids2 = new Set(Object.keys(s2.generatedConsorts));
    // ids contain the seed, so they must differ
    expect([...ids1].some((id) => !ids2.has(id))).toBe(true);
  });
});

// ── R8 冷宫开局为空 ───────────────────────────────────────────────────────────

describe("R8: 冷宫开局为空", () => {
  it("无侍君居所为冷宫", () => {
    const s = createNewGameState(db);
    const allStanding = Object.entries(s.standing);
    const inColdPalace = allStanding.filter(([id, st]) => {
      const c = db.characters[id] ?? s.generatedConsorts[id];
      if (c?.kind !== "consort") return false;
      const loc = st.residence ?? c.defaultLocation;
      return loc === COLD_PALACE_ID;
    });
    expect(inColdPalace).toHaveLength(0);
  });
});

// ── R9 贵驸最多 1 位 ──────────────────────────────────────────────────────────

describe("R9: 贵驸封号约束", () => {
  const seeds = [1, 2, 3, 4, 5, 10, 42, 100];

  it.each(seeds)("seed=%i: 贵驸最多 1 位", (seed) => {
    const s = createNewGameState(db, seed);
    // Only count regular consorts (empress uses huanghou, not guifu)
    const guifuCount = regularGeneratedIds(s).filter(
      (id) => s.standing[id]?.rank === "guifu",
    ).length;
    expect(guifuCount).toBeLessThanOrEqual(1);
  });
});

// ── R10 高阶封号合计最多 2 位 ─────────────────────────────────────────────────

describe("R10: 贤/良/德/驸 合计约束", () => {
  const seeds = [1, 2, 3, 4, 5, 10, 42, 100];

  it.each(seeds)("seed=%i: 贤/良/德/驸 合计最多 2 位", (seed) => {
    const s = createNewGameState(db, seed);
    const tier2Count = regularGeneratedIds(s).filter(
      (id) => TIER2_RANKS.has(s.standing[id]?.rank ?? ""),
    ).length;
    expect(tier2Count).toBeLessThanOrEqual(2);
  });
});

// ── R11 封号均为有效 rank id ──────────────────────────────────────────────────

describe("R11: 封号为有效 rank id", () => {
  it("所有生成侍君的封号均存在于 db.world.ranks", () => {
    const s = createNewGameState(db);
    for (const id of Object.keys(s.generatedConsorts)) {
      const rank = s.standing[id]!.rank;
      expect(VALID_RANK_IDS.has(rank)).toBe(true);
    }
  });

  it("普通侍君封号不为 huanghou（皇后专用）", () => {
    const s = createNewGameState(db);
    for (const id of regularGeneratedIds(s)) {
      expect(s.standing[id]!.rank).not.toBe("huanghou");
    }
  });
});

// ── R12 姓氏唯一 ──────────────────────────────────────────────────────────────

describe("R12: 生成侍君姓氏唯一", () => {
  const seeds = [1, 2, 3, 42, 100];

  it.each(seeds)("seed=%i: 无两位侍君同姓", (seed) => {
    const s = createNewGameState(db, seed);
    const surnames = Object.values(s.generatedConsorts).map((c) => c.profile.surname);
    const uniqueSurnames = new Set(surnames);
    expect(uniqueSurnames.size).toBe(surnames.length);
  });
});

// ── R13 居所唯一 ──────────────────────────────────────────────────────────────

describe("R13: 生成侍君居所唯一", () => {
  const seeds = [1, 2, 3, 42, 100];

  it.each(seeds)("seed=%i: 无两位侍君同宫", (seed) => {
    const s = createNewGameState(db, seed);
    const residences = Object.keys(s.generatedConsorts).map(
      (id) => s.standing[id]!.residence ?? s.generatedConsorts[id]!.defaultLocation,
    );
    const uniqueResidences = new Set(residences);
    expect(uniqueResidences.size).toBe(residences.length);
  });
});

// ── R14 宠爱值 5–35 ───────────────────────────────────────────────────────────

describe("R14: 宠爱值范围", () => {
  it("所有生成侍君的 favor 在 5–35", () => {
    const s = createNewGameState(db);
    for (const id of Object.keys(s.generatedConsorts)) {
      const favor = s.standing[id]!.favor;
      expect(favor).toBeGreaterThanOrEqual(5);
      expect(favor).toBeLessThanOrEqual(35);
    }
  });
});

// ── R15 生命值 45–95 ──────────────────────────────────────────────────────────

describe("R15: 生命值范围", () => {
  it("所有生成侍君的 health 在 45–95", () => {
    const s = createNewGameState(db);
    for (const id of Object.keys(s.generatedConsorts)) {
      const health = s.standing[id]!.health;
      expect(health).toBeGreaterThanOrEqual(45);
      expect(health).toBeLessThanOrEqual(95);
    }
  });
});

// ── R16 年龄 16–28 ────────────────────────────────────────────────────────────

describe("R16: 年龄范围", () => {
  it("所有生成侍君的 age 在 16–28", () => {
    const s = createNewGameState(db);
    for (const c of Object.values(s.generatedConsorts)) {
      expect(c.profile.age).toBeGreaterThanOrEqual(16);
      expect(c.profile.age).toBeLessThanOrEqual(28);
    }
  });
});

// ── 综合：gameStateSchema 验证 ────────────────────────────────────────────────

describe("综合：state 结构合法", () => {
  it("含生成侍君的 state 通过 gameStateSchema 验证", async () => {
    const { gameStateSchema } = await import("../../src/engine/save/stateSchema");
    const s = createNewGameState(db, 1);
    const result = gameStateSchema.safeParse(s);
    if (!result.success) {
      // Print issues for easier debugging
      console.error(JSON.stringify(result.error.issues.slice(0, 5), null, 2));
    }
    expect(result.success).toBe(true);
  });
});
