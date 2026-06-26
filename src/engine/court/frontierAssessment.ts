/**
 * 年度边情评估引擎（Phase 4C Task 2）。
 *
 * 提供：
 * - 战区轮换 `theaterForYear`
 * - 边患压力年度漂移 `calcFrontierPressureDelta`
 * - 烈度分类 `classifyFrontierSeverity`
 * - 评估规划（纯函数）`planFrontierAssessment`
 * - 完整性校验 `validateFrontierAssessments`（供 saveSystem.ts 加载路径调用）
 *
 * 纯函数——不触碰 store、不发事件、不操作 React。输入 state 永不变更。
 */
import { compareGameTime, type GameTime } from "../calendar/time";
import { gestationRollRaw } from "../characters/gestation";
import { stateError, type GameError } from "../infra/errors";
import type {
  FrontierSeverity,
  FrontierTheaterId,
  GameState,
  MilitaryMemorialMatter,
  MilitaryMemorialUrgency,
} from "../state/types";

// ── 工具 ───────────────────────────────────────────────────────────────────────

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

// ── 常量 ───────────────────────────────────────────────────────────────────────

/** 战区轮换顺序（1-based 年份 → 0-based mod 3）。 */
const THEATER_ROTATION: FrontierTheaterId[] = [
  "northern_frontier",
  "western_frontier",
  "southern_frontier",
];

// ── 战区轮换 ───────────────────────────────────────────────────────────────────

/**
 * 按年份返回本年度边情评估战区。
 * year=1 → northern_frontier，year=2 → western_frontier，year=3 → southern_frontier，
 * year=4 → northern_frontier，以此类推。
 */
export function theaterForYear(year: number): FrontierTheaterId {
  return THEATER_ROTATION[(year - 1) % 3]!;
}

// ── Canonical 派生函数（generator 和 validator 共用，防止逻辑漂移）──────────────

/** 由评估烈度推导军务奏折 matter。 */
export function matterFromSeverity(severity: FrontierSeverity): MilitaryMemorialMatter {
  if (severity === "stable") return "annual_readiness";
  if (severity === "watch") return "border_fortification";
  return "frontier_incursion";
}

/** 由评估烈度推导军务奏折 urgency。 */
export function urgencyFromSeverity(severity: FrontierSeverity): MilitaryMemorialUrgency {
  if (severity === "stable" || severity === "watch") return "routine";
  if (severity === "urgent") return "urgent";
  return "critical";
}

/** Canonical military memorial sourceId，由 matter/theaterId/year 确定性派生。 */
export function canonicalMilitarySourceId(
  matter: MilitaryMemorialMatter,
  theaterId: FrontierTheaterId,
  year: number,
): string {
  return `military:${matter}:${theaterId}:${year}`;
}

// ── 年度漂移计算 ───────────────────────────────────────────────────────────────

export interface FrontierPressureDelta {
  rawDrift: number;
  militaryModifier: number;
  governanceModifier: number;
  publicSupportModifier: number;
  pressureDelta: number;
}

/**
 * 计算本年度边患压力漂移及各项修正值。
 * 纯函数，不改变 state。
 */
export function calcFrontierPressureDelta(
  state: GameState,
  year: number,
): FrontierPressureDelta {
  const { military, governance, publicSupport } = state.resources.nation;

  // 原始漂移：(32位整数 % 11) − 3 → 范围 [-3, +7]
  const rawDrift =
    (gestationRollRaw(`frontier:drift:${year}:${state.rngSeed}`) % 11) - 3;

  // 军力修正（由最严重条件优先判断）
  let militaryModifier: number;
  if (military <= 25) {
    militaryModifier = +8;
  } else if (military <= 40) {
    militaryModifier = +5;
  } else if (military <= 55) {
    militaryModifier = +2;
  } else if (military >= 80) {
    militaryModifier = -5;
  } else if (military >= 65) {
    militaryModifier = -3;
  } else {
    militaryModifier = 0;
  }

  // 朝政修正
  let governanceModifier: number;
  if (governance < 35) {
    governanceModifier = +3;
  } else if (governance > 70) {
    governanceModifier = -2;
  } else {
    governanceModifier = 0;
  }

  // 民心修正
  const publicSupportModifier = publicSupport < 30 ? +2 : 0;

  // 最终漂移（钳 −10 至 +10）
  const pressureDelta = clamp(
    rawDrift + militaryModifier + governanceModifier + publicSupportModifier,
    -10,
    10,
  );

  return { rawDrift, militaryModifier, governanceModifier, publicSupportModifier, pressureDelta };
}

// ── 烈度分类 ───────────────────────────────────────────────────────────────────

/**
 * 按评估后压力值和当前军力确定边情烈度。
 * 优先级：critical > urgent > watch > stable。
 */
export function classifyFrontierSeverity(
  pressureAfter: number,
  military: number,
): FrontierSeverity {
  if (pressureAfter >= 80 || military <= 25) return "critical";
  if (pressureAfter >= 60 || military <= 40) return "urgent";
  if (pressureAfter >= 40) return "watch";
  return "stable";
}

// ── 规划中间体 ─────────────────────────────────────────────────────────────────

/**
 * `planFrontierAssessment` 的返回类型。
 * 不含 `generation` 字段——由 Task 3 的奏折生成器补全后写入 state.frontierAssessments。
 */
export interface FrontierAssessmentPlan {
  id: string;
  year: number;
  assessedAt: GameTime;
  theaterId: FrontierTheaterId;
  pressureBefore: number;
  pressureDelta: number;
  pressureAfter: number;
  militaryAtAssessment: number;
  governanceAtAssessment: number;
  publicSupportAtAssessment: number;
  severity: FrontierSeverity;
  rawDrift: number;
  militaryModifier: number;
  governanceModifier: number;
  publicSupportModifier: number;
}

// ── 存在性检查 ─────────────────────────────────────────────────────────────────

/** 本年度是否已存在边情评估记录。 */
export function hasFrontierAssessmentForYear(
  state: GameState,
  year: number,
): boolean {
  return state.frontierAssessments.some((a) => a.year === year);
}

// ── 规划（纯函数） ─────────────────────────────────────────────────────────────

/**
 * 规划本年度边情评估（纯函数，不写 state）。
 * 若当年已有评估记录则返回 null（去重保护）。
 *
 * 调用方（Task 3 奏折生成器）应：
 * 1. 调用 `planFrontierAssessment` 获取规划体；
 * 2. 通过 effect funnel 更新 borderPressure；
 * 3. 生成对应军务奏折；
 * 4. 补全 `generation` 字段后追加到 state.frontierAssessments。
 */
export function planFrontierAssessment(
  state: GameState,
  at: GameTime,
): FrontierAssessmentPlan | null {
  if (hasFrontierAssessmentForYear(state, at.year)) return null;

  const { military, governance, publicSupport, borderPressure } =
    state.resources.nation;

  const pressureBefore = borderPressure;
  const deltas = calcFrontierPressureDelta(state, at.year);
  const pressureAfter = clamp(pressureBefore + deltas.pressureDelta, 0, 100);
  const theaterId = theaterForYear(at.year);
  const severity = classifyFrontierSeverity(pressureAfter, military);

  return {
    id: `frontier_assessment:${at.year}`,
    year: at.year,
    assessedAt: { ...at },
    theaterId,
    pressureBefore,
    pressureDelta: deltas.pressureDelta,
    pressureAfter,
    militaryAtAssessment: military,
    governanceAtAssessment: governance,
    publicSupportAtAssessment: publicSupport,
    severity,
    rawDrift: deltas.rawDrift,
    militaryModifier: deltas.militaryModifier,
    governanceModifier: deltas.governanceModifier,
    publicSupportModifier: deltas.publicSupportModifier,
  };
}

// ── 完整性校验 ─────────────────────────────────────────────────────────────────

const VALID_THEATER_IDS: ReadonlySet<string> = new Set([
  "northern_frontier",
  "western_frontier",
  "southern_frontier",
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "stable",
  "watch",
  "urgent",
  "critical",
]);

/**
 * 校验 state.frontierAssessments 的持久不变量，返回所有发现的 GameError。
 * 供存档加载路径（saveSystem.ts）调用；纯函数，不修改 state。
 */
export function validateFrontierAssessments(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const e = (code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, message, context ? { context } : undefined));

  const assessments = state.frontierAssessments;
  const seenIds = new Set<string>();
  const seenYears = new Set<number>();
  // Track all generated memorial IDs for orphan check after loop.
  const generatedMemorialIds = new Set<string>();

  for (let i = 0; i < assessments.length; i++) {
    const a = assessments[i]!;

    // 1. ID 格式必须为 frontier_assessment:{year}
    const expectedId = `frontier_assessment:${a.year}`;
    if (a.id !== expectedId) {
      e("FRONTIER_INVALID_ID", `边情评估第 ${i} 条 id 不合法：「${a.id}」（期望 「${expectedId}」）`, {
        index: i, id: a.id, expectedId,
      });
    }

    // 2. ID 唯一性
    if (seenIds.has(a.id)) {
      e("FRONTIER_DUPLICATE_ID", `边情评估 id 重复：「${a.id}」`, { index: i, id: a.id });
    }
    seenIds.add(a.id);

    // 3. year 为正整数
    if (!Number.isInteger(a.year) || a.year < 1) {
      e("FRONTIER_INVALID_YEAR", `边情评估第 ${i} 条 year 不合法：${a.year}`, {
        index: i, year: a.year,
      });
    }

    // 4. 每年至多一条
    if (seenYears.has(a.year)) {
      e("FRONTIER_DUPLICATE_YEAR", `边情评估年份重复：${a.year}`, { index: i, year: a.year });
    }
    seenYears.add(a.year);

    // 5. 数组按年份非递减
    if (i > 0) {
      const prev = assessments[i - 1]!;
      if (a.year < prev.year) {
        e("FRONTIER_NOT_SORTED", `边情评估第 ${i} 条 year(${a.year}) 早于第 ${i - 1} 条 year(${prev.year})`, {
          index: i, year: a.year, prevYear: prev.year,
        });
      }
    }

    // 6. assessedAt.year === assessment.year
    if (a.assessedAt.year !== a.year) {
      e("FRONTIER_ASSESSED_AT_MISMATCH", `边情评估第 ${i} 条 assessedAt.year(${a.assessedAt.year}) ≠ year(${a.year})`, {
        index: i, assessedAtYear: a.assessedAt.year, year: a.year,
      });
    }

    // 7. theaterId 合法
    if (!VALID_THEATER_IDS.has(a.theaterId)) {
      e("FRONTIER_INVALID_THEATER", `边情评估第 ${i} 条 theaterId 不合法：「${a.theaterId}」`, {
        index: i, theaterId: a.theaterId,
      });
    }

    // 8. pressureBefore 0–100 整数
    if (!Number.isInteger(a.pressureBefore) || a.pressureBefore < 0 || a.pressureBefore > 100) {
      e("FRONTIER_BAD_PRESSURE", `边情评估第 ${i} 条 pressureBefore 不合法：${a.pressureBefore}`, {
        index: i, pressureBefore: a.pressureBefore,
      });
    }

    // 9. pressureAfter 0–100 整数
    if (!Number.isInteger(a.pressureAfter) || a.pressureAfter < 0 || a.pressureAfter > 100) {
      e("FRONTIER_BAD_PRESSURE", `边情评估第 ${i} 条 pressureAfter 不合法：${a.pressureAfter}`, {
        index: i, pressureAfter: a.pressureAfter,
      });
    }

    // 10. pressureDelta −10 至 +10 整数
    if (!Number.isInteger(a.pressureDelta) || a.pressureDelta < -10 || a.pressureDelta > 10) {
      e("FRONTIER_BAD_DELTA", `边情评估第 ${i} 条 pressureDelta 不合法：${a.pressureDelta}`, {
        index: i, pressureDelta: a.pressureDelta,
      });
    }

    // 11. pressureAfter === clamp(pressureBefore + pressureDelta, 0, 100)
    const expectedAfter = clamp(a.pressureBefore + a.pressureDelta, 0, 100);
    if (a.pressureAfter !== expectedAfter) {
      e("FRONTIER_BAD_EQUATION", `边情评估第 ${i} 条 pressureAfter(${a.pressureAfter}) ≠ clamp(${a.pressureBefore}+${a.pressureDelta},0,100)=${expectedAfter}`, {
        index: i, pressureBefore: a.pressureBefore, pressureDelta: a.pressureDelta,
        pressureAfter: a.pressureAfter, expectedAfter,
      });
    }

    // 12. militaryAtAssessment / governanceAtAssessment / publicSupportAtAssessment 0–100 整数
    for (const [field, val] of [
      ["militaryAtAssessment", a.militaryAtAssessment],
      ["governanceAtAssessment", a.governanceAtAssessment],
      ["publicSupportAtAssessment", a.publicSupportAtAssessment],
    ] as [string, number][]) {
      if (!Number.isInteger(val) || val < 0 || val > 100) {
        e("FRONTIER_BAD_SNAPSHOT", `边情评估第 ${i} 条 ${field} 不合法：${val}`, {
          index: i, field, value: val,
        });
      }
    }

    // 13. severity 合法值
    if (!VALID_SEVERITIES.has(a.severity)) {
      e("FRONTIER_BAD_SEVERITY", `边情评估第 ${i} 条 severity 不合法：「${a.severity}」`, {
        index: i, severity: a.severity,
      });
    }

    // 14. severity 与 pressureAfter / militaryAtAssessment 一致
    const expectedSeverity = classifyFrontierSeverity(a.pressureAfter, a.militaryAtAssessment);
    if (a.severity !== expectedSeverity) {
      e("FRONTIER_BAD_SEVERITY", `边情评估第 ${i} 条 severity(${a.severity}) 与推导值(${expectedSeverity})不符`, {
        index: i, severity: a.severity, expectedSeverity,
        pressureAfter: a.pressureAfter, militaryAtAssessment: a.militaryAtAssessment,
      });
    }

    // 15–19. generation 字段校验
    const gen = a.generation;
    if (gen.status === "generated") {
      // 15. memorialId 存在于 state.memorials
      const memorial = state.memorials[gen.memorialId];
      if (!memorial) {
        e("FRONTIER_MISSING_MEMORIAL", `边情评估第 ${i} 条 generation.memorialId「${gen.memorialId}」在奏折表中不存在`, {
          index: i, memorialId: gen.memorialId,
        });
      } else {
        // 16. 关联奏折类别必须为 military
        if (memorial.payload.category !== "military") {
          e("FRONTIER_MEMORIAL_WRONG_CATEGORY", `边情评估第 ${i} 条关联奏折「${gen.memorialId}」类别为「${memorial.payload.category}」，非 military`, {
            index: i, memorialId: gen.memorialId, category: memorial.payload.category,
          });
        } else {
          const p = memorial.payload;

          // 17a. theaterId 必须与 assessment 一致
          if (p.theaterId !== a.theaterId) {
            e("FRONTIER_THEATER_MISMATCH", `边情评估第 ${i} 条关联奏折 theaterId「${p.theaterId}」≠ assessment.theaterId「${a.theaterId}」`, {
              index: i, memorialId: gen.memorialId, memorialTheater: p.theaterId, assessmentTheater: a.theaterId,
            });
          }

          // 17b. pressureAtCreation 必须等于 assessment.pressureAfter
          if (p.pressureAtCreation !== a.pressureAfter) {
            e("FRONTIER_PRESSURE_SNAPSHOT_MISMATCH", `边情评估第 ${i} 条关联奏折 pressureAtCreation(${p.pressureAtCreation}) ≠ assessment.pressureAfter(${a.pressureAfter})`, {
              index: i, memorialId: gen.memorialId, pressureAtCreation: p.pressureAtCreation, pressureAfter: a.pressureAfter,
            });
          }

          // 17c. militaryAtCreation 必须等于 assessment.militaryAtAssessment
          if (p.militaryAtCreation !== a.militaryAtAssessment) {
            e("FRONTIER_MILITARY_SNAPSHOT_MISMATCH", `边情评估第 ${i} 条关联奏折 militaryAtCreation(${p.militaryAtCreation}) ≠ assessment.militaryAtAssessment(${a.militaryAtAssessment})`, {
              index: i, memorialId: gen.memorialId, militaryAtCreation: p.militaryAtCreation, militaryAtAssessment: a.militaryAtAssessment,
            });
          }

          // 17d. matter 必须与 severity 推导值一致
          const expectedMatter = matterFromSeverity(a.severity);
          if (p.matter !== expectedMatter) {
            e("FRONTIER_MATTER_MISMATCH", `边情评估第 ${i} 条关联奏折 matter「${p.matter}」≠ 由 severity「${a.severity}」推导值「${expectedMatter}」`, {
              index: i, memorialId: gen.memorialId, matter: p.matter, expectedMatter, severity: a.severity,
            });
          }

          // 17e. urgency 必须与 severity 推导值一致
          const expectedUrgency = urgencyFromSeverity(a.severity);
          if (p.urgency !== expectedUrgency) {
            e("FRONTIER_URGENCY_MISMATCH", `边情评估第 ${i} 条关联奏折 urgency「${p.urgency}」≠ 由 severity「${a.severity}」推导值「${expectedUrgency}」`, {
              index: i, memorialId: gen.memorialId, urgency: p.urgency, expectedUrgency, severity: a.severity,
            });
          }

          // 17f. sourceId 必须符合 canonical 规则
          const expectedSourceId = canonicalMilitarySourceId(p.matter, a.theaterId, a.year);
          if (memorial.sourceId !== expectedSourceId) {
            e("FRONTIER_SOURCEID_MISMATCH", `边情评估第 ${i} 条关联奏折 sourceId「${memorial.sourceId}」≠ canonical「${expectedSourceId}」`, {
              index: i, memorialId: gen.memorialId, sourceId: memorial.sourceId, expectedSourceId,
            });
          }

          // 17g. assessment 的战区必须符合年度轮换规则
          const expectedTheater = theaterForYear(a.year);
          if (a.theaterId !== expectedTheater) {
            e("FRONTIER_THEATER_ROTATION_MISMATCH", `边情评估第 ${i} 条 theaterId「${a.theaterId}」≠ 年度轮换值「${expectedTheater}」(year=${a.year})`, {
              index: i, theaterId: a.theaterId, expectedTheater, year: a.year,
            });
          }

          // 17h. 本 memorial 只能被一条 assessment 引用（稍后通过 generatedMemorialIds 检查）
          generatedMemorialIds.add(gen.memorialId);
        }

        // 17. memorial.createdAt >= assessedAt
        if (compareGameTime(memorial.createdAt, a.assessedAt) < 0) {
          e("FRONTIER_MEMORIAL_TOO_EARLY", `边情评估第 ${i} 条关联奏折「${gen.memorialId}」createdAt 早于 assessedAt`, {
            index: i, memorialId: gen.memorialId,
            memorialCreatedAt: memorial.createdAt, assessedAt: a.assessedAt,
          });
        }
      }
    } else if (gen.status === "blocked_by_pending") {
      // 18. blockingMemorialId 存在于 state.memorials
      const blocking = state.memorials[gen.blockingMemorialId];
      if (!blocking) {
        e("FRONTIER_MISSING_BLOCKING", `边情评估第 ${i} 条 generation.blockingMemorialId「${gen.blockingMemorialId}」在奏折表中不存在`, {
          index: i, blockingMemorialId: gen.blockingMemorialId,
        });
      } else {
        // 19. 拦截奏折类别必须为 military
        if (blocking.payload.category !== "military") {
          e("FRONTIER_MEMORIAL_WRONG_CATEGORY", `边情评估第 ${i} 条拦截奏折「${gen.blockingMemorialId}」类别为「${blocking.payload.category}」，非 military`, {
            index: i, blockingMemorialId: gen.blockingMemorialId, category: blocking.payload.category,
          });
        }

        // 19b. blocking memorial createdAt ≤ assessment.assessedAt（blocking 发生在评估之前或同时）
        if (compareGameTime(blocking.createdAt, a.assessedAt) > 0) {
          e("FRONTIER_BLOCKING_TOO_LATE", `边情评估第 ${i} 条拦截奏折「${gen.blockingMemorialId}」createdAt 晚于 assessedAt`, {
            index: i, blockingMemorialId: gen.blockingMemorialId,
            blockingCreatedAt: blocking.createdAt, assessedAt: a.assessedAt,
          });
        }
      }
    }
  }

  // Post-loop: 检查 generatedMemorialIds 是否有重复引用（两条 assessment 指向同一 memorial）。
  // 注意：上面循环中每次 add 前已检查 memorial 合法性，此处只需检查 Set 的大小。
  // 实际上 generatedMemorialIds 是 Set，不会有重复条目。但我们还需反向检查：
  // 每条 military memorial 最多被一条 generated assessment 引用。
  for (const [memId, mem] of Object.entries(state.memorials)) {
    if (mem.payload.category !== "military") continue;
    // orphan check：已 resolved 的 military memorial 应该有一条 generated assessment 引用它
    // （pending memorial 可能尚未被引用，不强制）
    if (mem.status === "resolved" && !generatedMemorialIds.has(memId)) {
      e("FRONTIER_ORPHAN_MEMORIAL", `已批阅军务奏折「${memId}」未被任何边情评估引用`, {
        memorialId: memId,
      });
    }
  }

  return errors;
}
