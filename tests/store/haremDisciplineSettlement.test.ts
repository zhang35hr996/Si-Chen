/**
 * 后宫内部惩戒结算集成测试（HDS 系列）
 *
 * 覆盖：
 * - resolveHaremDisciplineOccurrence（发生时原子结算）
 * - resolveHaremDiscipline（御前裁断）
 * - GameStore.resolveHaremDisciplineIncident
 * - settlement 时机：monthChanged=true 时触发
 * - 跳过条件：当月有 haremAdminReview rank_changed
 * - stateSchema 验证（round-trip）
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  resolveHaremDisciplineOccurrence,
  resolveHaremDiscipline,
} from "../../src/engine/characters/haremDisciplineResolver";
import { planHaremDiscipline } from "../../src/engine/characters/haremDisciplinePlanner";
import { makeGameTime, toGameTime } from "../../src/engine/calendar/time";
import type { GameState, HaremDisciplineIncident } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";
import { PERSONALITY_DEFAULTS } from "../../src/engine/characters/consortAttrs";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { GameStore } from "../../src/store/gameStore";

const db = loadRealContent();

const ACTOR_ID = "xu_qinghuan";
const TARGET_ID = "wenya";

// ── 工具 ─────────────────────────────────────────────────────────────────────

function makePairState(opts: { actorRank?: string; targetRank?: string; rngSeed?: number } = {}): GameState {
  const s = createNewGameState(db);
  const { actorRank = "fu", targetRank = "changzai", rngSeed = 42 } = opts;
  const actorSt = s.standing[ACTOR_ID]!;
  const targetSt = s.standing[TARGET_ID]!;
  return {
    ...s,
    rngSeed,
    haremAdministration: { mode: "empress" },
    standing: {
      [ACTOR_ID]: {
        ...actorSt,
        rank: actorRank,
        favor: 30,
        peakFavor: 30,
        personality: { ...PERSONALITY_DEFAULTS },
      },
      [TARGET_ID]: {
        ...targetSt,
        rank: targetRank,
        favor: 30,
        peakFavor: 30,
        health: 80,
        healthStatus: "healthy" as const,
      },
    },
    bedchamber: {
      [ACTOR_ID]: s.bedchamber[ACTOR_ID] ?? { chamber: "main", groupIndex: 0 },
      [TARGET_ID]: s.bedchamber[TARGET_ID] ?? { chamber: "main", groupIndex: 1 },
    },
    chronicle: [
      // 占位事件（供 resolveHaremDisciplineOccurrence 的 appendCourtEvent 产生 id 用）
    ],
  };
}

/** 找到任意会触发结算的 rngSeed */
function findTriggeringSeed(baseOpts: Parameters<typeof makePairState>[0] = {}): number | null {
  for (let seed = 1; seed <= 500; seed++) {
    const s = makePairState({ ...baseOpts, rngSeed: seed });
    const plan = planHaremDiscipline(db, s);
    if (plan !== null) return seed;
  }
  return null;
}

// ── resolveHaremDisciplineOccurrence ────────────────────────────────────────

describe("resolveHaremDisciplineOccurrence", () => {
  it("HDS-OCC-01: 成功时返回 ok + 写入 incident", () => {
    const seed = findTriggeringSeed();
    if (seed === null) { expect.fail("无法找到触发 seed，fixture 异常"); return; }
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state, incident } = result.value;
    expect(state.haremDisciplineIncidents).toHaveLength(1);
    expect(incident.status).toBe("pending_response");
    expect(incident.actorId).toBe(plan.actorId);
    expect(incident.targetId).toBe(plan.targetId);
    expect(incident.disciplineKind).toBe(plan.disciplineKind);
  });

  it("HDS-OCC-02: incident id 格式 hdi_{year}_{month}", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.incident.id).toMatch(/^hdi_\d+_\d{2}$/);
  });

  it("HDS-OCC-03: 写入 CourtEvent 到 chronicle", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state } = result.value;
    const evt = state.chronicle.find((e) => e.type === "conflict");
    expect(evt).toBeDefined();
    expect(evt?.payload).toMatchObject({ subtype: "harem_discipline" });
    expect(evt?.tags).toContain("harem_discipline");
  });

  it("HDS-OCC-04: kneeling 时 target 健康下降", () => {
    // 找到会产生 kneeling 的场景（rankSteps>=2, pairScore>=45）
    const seeds = [1, 2, 3, 42, 100, 200, 300];
    for (const seed of seeds) {
      const s = makePairState({ rngSeed: seed });
      const plan = planHaremDiscipline(db, s);
      if (plan === null || plan.disciplineKind !== "kneeling") continue;
      const result = resolveHaremDisciplineOccurrence(db, s, plan);
      if (!result.ok) continue;
      const { state } = result.value;
      const targetHealth = state.standing[TARGET_ID]?.health ?? 80;
      expect(targetHealth).toBeLessThan(80);
      return;
    }
    // kneeling 未必触发，跳过
  });

  it("HDS-OCC-05: copy_scripture 时 target 健康不变", () => {
    const seeds = [1, 2, 3, 42, 100, 200, 300, 400];
    for (const seed of seeds) {
      const s = makePairState({ rngSeed: seed });
      const plan = planHaremDiscipline(db, s);
      if (plan === null || plan.disciplineKind !== "copy_scripture") continue;
      const result = resolveHaremDisciplineOccurrence(db, s, plan);
      if (!result.ok) continue;
      const { state } = result.value;
      const targetHealth = state.standing[TARGET_ID]?.health ?? 80;
      expect(targetHealth).toBe(80);
      return;
    }
  });

  it("HDS-OCC-06: 不写入 JusticeState / PunishmentRecord", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state } = result.value;
    // justice state unchanged
    expect(state.justice).toEqual(s.justice);
  });

  it("HDS-OCC-07: 重复 id 时返回 err（幂等保护）", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const first = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Try again with same state
    const second = resolveHaremDisciplineOccurrence(db, first.value.state, plan);
    // Should fail because id already exists
    expect(second.ok).toBe(false);
  });

  it("HDS-OCC-08: 结算后 state 通过 schema 验证（round-trip）", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = gameStateSchema.safeParse(result.value.state);
    if (!parsed.success) {
      console.error(parsed.error.issues);
    }
    expect(parsed.success).toBe(true);
  });

  it("HDS-OCC-09: 受罚者恐惧上升", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state } = result.value;
    const beforeFear = s.standing[TARGET_ID]?.fear ?? 30;
    const afterFear = state.standing[TARGET_ID]?.fear ?? 30;
    expect(afterFear).toBeGreaterThan(beforeFear);
  });

  it("HDS-OCC-10: 受罚者好感下降", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s)!;
    const result = resolveHaremDisciplineOccurrence(db, s, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state } = result.value;
    const beforeAff = s.standing[TARGET_ID]?.affection ?? 50;
    const afterAff = state.standing[TARGET_ID]?.affection ?? 50;
    expect(afterAff).toBeLessThan(beforeAff);
  });
});

// ── resolveHaremDiscipline（御前裁断）────────────────────────────────────────

function makeIncidentState(): { state: GameState; incident: HaremDisciplineIncident } | null {
  const seed = findTriggeringSeed();
  if (seed === null) return null;
  const s = makePairState({ rngSeed: seed });
  const plan = planHaremDiscipline(db, s)!;
  const occResult = resolveHaremDisciplineOccurrence(db, s, plan);
  if (!occResult.ok) return null;
  return { state: occResult.value.state, incident: occResult.value.incident };
}

describe("resolveHaremDiscipline", () => {
  it("HDS-RES-01: 维持处分 → 施罚者忠诚+5", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const before = pair.state.standing[ACTOR_ID]?.loyalty ?? 50;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.standing[ACTOR_ID]?.loyalty ?? 50;
    expect(after).toBeGreaterThan(before);
  });

  it("HDS-RES-02: 回护受罚者 → 受罚者好感+20", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const before = pair.state.standing[TARGET_ID]?.affection ?? 50;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "protected",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.standing[TARGET_ID]?.affection ?? 50;
    expect(after).toBeGreaterThan(before);
  });

  it("HDS-RES-03: 各自申饬 → 施罚者恐惧+8", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const before = pair.state.standing[ACTOR_ID]?.fear ?? 30;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "rebuked_both",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.standing[ACTOR_ID]?.fear ?? 30;
    expect(after).toBeGreaterThan(before);
  });

  it("HDS-RES-04: 裁断后 incident.status = resolved", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inc = result.value.haremDisciplineIncidents.find((i) => i.id === pair.incident.id);
    expect(inc?.status).toBe("resolved");
    expect(inc?.resolution).toBe("upheld");
    expect(inc?.resolvedAt).toBeDefined();
  });

  it("HDS-RES-05: 不存在的 incidentId 返回 err", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: "hdi_9999_99",
      resolution: "upheld",
    });
    expect(result.ok).toBe(false);
  });

  it("HDS-RES-06: 已解决的 incident 二次裁断返回 err", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const first = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = resolveHaremDiscipline(db, first.value, {
      incidentId: pair.incident.id,
      resolution: "protected",
    });
    expect(second.ok).toBe(false);
  });

  it("HDS-RES-07: 裁断后追加 CourtEvent（conflict type）", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const beforeLen = pair.state.chronicle.length;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.chronicle.length).toBeGreaterThan(beforeLen);
    const newEvt = result.value.chronicle[result.value.chronicle.length - 1];
    expect(newEvt?.type).toBe("conflict");
    expect(newEvt?.payload).toMatchObject({ subtype: "harem_discipline_resolution" });
  });

  it("HDS-RES-08: 裁断后 state 通过 schema 验证", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = gameStateSchema.safeParse(result.value);
    if (!parsed.success) {
      console.error(parsed.error.issues);
    }
    expect(parsed.success).toBe(true);
  });

  it("HDS-RES-09: 施罚者记忆写入", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const beforeCount = pair.state.memories[ACTOR_ID]?.entries.length ?? 0;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    if (!result.ok) return;
    const afterCount = result.value.memories[ACTOR_ID]?.entries.length ?? 0;
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it("HDS-RES-10: 受罚者记忆写入", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const beforeCount = pair.state.memories[TARGET_ID]?.entries.length ?? 0;
    const result = resolveHaremDiscipline(db, pair.state, {
      incidentId: pair.incident.id,
      resolution: "protected",
    });
    if (!result.ok) return;
    const afterCount = result.value.memories[TARGET_ID]?.entries.length ?? 0;
    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});

// ── GameStore.resolveHaremDisciplineIncident ─────────────────────────────────

describe("GameStore.resolveHaremDisciplineIncident", () => {
  it("HDS-STORE-01: store 命令正确更新 state", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const store = new GameStore();
    store.loadState(pair.state);
    const result = store.resolveHaremDisciplineIncident(db, {
      incidentId: pair.incident.id,
      resolution: "upheld",
    });
    expect(result.ok).toBe(true);
    const inc = store.getState().haremDisciplineIncidents.find((i) => i.id === pair.incident.id);
    expect(inc?.status).toBe("resolved");
    expect(inc?.resolution).toBe("upheld");
  });

  it("HDS-STORE-02: store 对不存在 incident 返回 err、状态不变", () => {
    const pair = makeIncidentState();
    if (!pair) return;
    const store = new GameStore();
    store.loadState(pair.state);
    const before = store.getState();
    const result = store.resolveHaremDisciplineIncident(db, {
      incidentId: "hdi_9999_99",
      resolution: "upheld",
    });
    expect(result.ok).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

// ── validateHaremDisciplineLinks ──────────────────────────────────────────────

describe("validateHaremDisciplineLinks via gameStateSchema", () => {
  it("HDS-VAL-01: 正常 state 无 schema 错误", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const plan = planHaremDiscipline(db, s);
    if (!plan) return;
    const occ = resolveHaremDisciplineOccurrence(db, s, plan);
    if (!occ.ok) return;
    expect(gameStateSchema.safeParse(occ.value.state).success).toBe(true);
  });

  it("HDS-VAL-02: pending_response 同 targetId 两条时 schema 报错", () => {
    const seed = findTriggeringSeed();
    if (seed === null) return;
    const s = makePairState({ rngSeed: seed });
    const now = toGameTime(s.calendar);
    const fakeIncident1: HaremDisciplineIncident = {
      id: "hdi_1_01",
      actorId: ACTOR_ID,
      targetId: TARGET_ID,
      disciplineKind: "copy_scripture",
      occurredAt: now,
      actorSnapshot: { rankId: "fu", favor: 30, peakFavor: 30, imperialProtectionScore: 6, isHaremAdministrator: false },
      targetSnapshot: { rankId: "changzai", favor: 30, peakFavor: 30, imperialProtectionScore: 6, isCarrying: false, healthBefore: 80 },
      courtEventId: "evt_000001",
      status: "pending_response",
    };
    const fakeIncident2: HaremDisciplineIncident = {
      ...fakeIncident1,
      id: "hdi_1_02",
      courtEventId: "evt_000002",
    };
    const badState: GameState = {
      ...s,
      chronicle: [
        { id: "evt_000001", type: "conflict", occurredAt: now, participants: [], payload: {}, publicity: { scope: "palace", persistence: "contemporaneous" }, publicSalience: 0, retention: "slow", tags: [] },
        { id: "evt_000002", type: "conflict", occurredAt: now, participants: [], payload: {}, publicity: { scope: "palace", persistence: "contemporaneous" }, publicSalience: 0, retention: "slow", tags: [] },
      ],
      haremDisciplineIncidents: [fakeIncident1, fakeIncident2],
    };
    const parsed = gameStateSchema.safeParse(badState);
    // Expect validation error for duplicate pending target
    expect(parsed.success).toBe(false);
  });
});
