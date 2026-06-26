/**
 * 紫宸殿奏折框架（Phase 4A/4B）。通用 Memorial 模型 + 地方灾情（Phase 4A）+ 财政奏折（Phase 4B）。
 * 所有奏折批阅均原子进行：treasury 事务先于 effect funnel，任一步失败均不修改输入 state。
 * 后果一律经正式 effect funnel（绝不直接改 state）。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { EventEffect } from "../content/schemas";
import { compareGameTime } from "../calendar/time";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import { gestationRoll } from "../characters/gestation";
import { applyEffects } from "../effects/funnel";
import { applyTreasuryTransaction } from "./treasuryLedger";
import type {
  FrontierAssessment,
  FrontierTheaterId,
  FrontierSeverity,
  GameState,
  Memorial,
  MemorialOption,
  MemorialResourceEffect,
  MilitaryMemorialMatter,
  MilitaryMemorialUrgency,
} from "../state/types";
import type { FrontierAssessmentPlan } from "./frontierAssessment";
import { hasFrontierAssessmentForYear, planFrontierAssessment } from "./frontierAssessment";

/** 已知地域（id → 显示名）。灾情奏折只在此集合内生成；validator 据此判定 regionId 合法。 */
export const DISASTER_REGIONS: Record<string, string> = {
  jiangnan: "江南",
  hebei: "河北",
  longxi: "陇西",
  lingnan: "岭南",
};
const DISASTER_REGION_IDS = Object.keys(DISASTER_REGIONS).sort();

/** 灾情处置各选项国库消耗常量（负值=支出；undefined=无变化）。 */
const DISASTER_TREASURY = {
  minor: { relief: -400 as const, tax_remit: -250 as const, ignore: undefined },
  major: { relief: -900 as const, tax_remit: -600 as const, ignore: undefined },
} as const;

/** "mem_000001" 单调。 */
export function memorialId(seq: number): string {
  return `mem_${String(seq).padStart(6, "0")}`;
}

/** 扫描现有合法 id 最大序号 +1（忽略异常 key，杜绝稀疏键覆盖）。 */
function nextMemorialId(state: GameState): string {
  let maxSeq = 0;
  for (const id of Object.keys(state.memorials)) {
    const m = /^mem_(\d{6})$/.exec(id);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return memorialId(maxSeq + 1);
}

/** 同一 sourceId 全局至多一条（pending 或 resolved 均算已存在）。 */
export function hasMemorialForSource(state: GameState, sourceId: string): boolean {
  return Object.values(state.memorials).some((m) => m.sourceId === sourceId);
}

const res = (pillar: "nation" | "sovereign", field: string, delta: number): MemorialResourceEffect =>
  ({ type: "resource", pillar, field, delta });

/** 灾情三选项（确定性，按严重度缩放；带 treasuryDelta 国库消耗；受 AXIS_CAP 限）。 */
function disasterOptions(severity: "minor" | "major"): MemorialOption[] {
  const m = severity === "major" ? 2 : 1;
  const costs = DISASTER_TREASURY[severity];
  return [
    {
      id: "relief",
      label: "开仓赈济",
      effects: [res("nation", "publicSupport", 4 * m), res("nation", "clanDiscontent", -3 * m), res("nation", "productivity", 2 * m)],
      treasuryDelta: costs.relief,
    },
    {
      id: "tax_remit",
      label: "蠲免赋税",
      effects: [res("nation", "publicSupport", 3 * m), res("nation", "clanDiscontent", -4 * m), res("nation", "productivity", -2 * m)],
      treasuryDelta: costs.tax_remit,
    },
    {
      id: "ignore",
      label: "不予理会",
      effects: [res("nation", "publicSupport", -4 * m), res("nation", "rumor", 3 * m), res("sovereign", "regimeSecurity", -3 * m)],
      // ignore: no treasuryDelta
    },
  ];
}

/**
 * 生成一条地方灾情奏折。资格：regionId 已知、同源（地域+年度）未生成过。后果选项确定性、随严重度缩放。
 * 不合格返回 null（不抛）。
 */
export function generateDisasterMemorial(
  state: GameState,
  regionId: string,
  severity: "minor" | "major",
  at: GameTime,
): { state: GameState; memorial: Memorial } | null {
  const region = DISASTER_REGIONS[regionId];
  if (!region) return null;
  const sourceId = `disaster:${regionId}:${at.year}`;
  if (hasMemorialForSource(state, sourceId)) return null;
  const memorial: Memorial = {
    id: nextMemorialId(state),
    category: "disaster",
    status: "pending",
    createdAt: at,
    sourceId,
    title: `${region}灾情奏报`,
    summary: `${region}遭遇${severity === "major" ? "大" : ""}灾，地方告急。请陛下裁示赈济之策。`,
    payload: { category: "disaster", regionId, severity, options: disasterOptions(severity) },
  };
  return { state: { ...state, memorials: { ...state.memorials, [memorial.id]: memorial } }, memorial };
}

/**
 * 年度灾情生成 seam（生产可达）：每年确定性择一地域 + 严重度生成一条灾情奏折。地域按年轮转，严重度由确定性
 * roll 决定；同源去重保证幂等。应在年度 tick 调用一次。
 */
export function maybeGenerateAnnualDisaster(state: GameState, at: GameTime): GameState {
  const regionId = DISASTER_REGION_IDS[(at.year - 1) % DISASTER_REGION_IDS.length]!;
  const severity = gestationRoll(`disaster:severity:${at.year}:${state.rngSeed}`) % 2 === 0 ? "major" : "minor";
  return generateDisasterMemorial(state, regionId, severity, at)?.state ?? state;
}

// ── 财政奏折（Phase 4B）────────────────────────────────────────────────────────

/** 财政奏折选项 id 枚举（导出供测试使用）。 */
export const TREASURY_OPTION_IDS = ["audit", "surtax", "defer"] as const;

interface TreasuryOptionDef {
  effects: MemorialResourceEffect[];
  treasuryDelta?: number;
}
interface TreasuryOptionSet {
  audit: TreasuryOptionDef;
  surtax: TreasuryOptionDef;
  defer: TreasuryOptionDef;
}

/** 财政奏折各选项定义（按紧急度分档）。 */
const TREASURY_OPTIONS: Record<"routine" | "urgent", TreasuryOptionSet> = {
  routine: {
    audit: {
      effects: [
        res("nation", "corruption", -5),
        res("nation", "governance", 2),
        res("nation", "ministerLoyalty", -2),
      ],
      treasuryDelta: 600,
    },
    surtax: {
      effects: [
        res("nation", "publicSupport", -6),
        res("nation", "productivity", -3),
        res("nation", "rumor", 2),
      ],
      treasuryDelta: 1000,
    },
    defer: {
      effects: [
        res("nation", "corruption", 2),
        res("nation", "governance", -2),
      ],
    },
  },
  urgent: {
    audit: {
      effects: [
        res("nation", "corruption", -6),
        res("nation", "governance", 2),
        res("nation", "ministerLoyalty", -3),
      ],
      treasuryDelta: 1200,
    },
    surtax: {
      effects: [
        res("nation", "publicSupport", -8),
        res("nation", "productivity", -4),
        res("nation", "rumor", 3),
      ],
      treasuryDelta: 1800,
    },
    defer: {
      effects: [
        res("nation", "corruption", 2),
        res("nation", "governance", -2),
      ],
    },
  },
};

/** 按紧急度构造三个财政奏折选项。 */
function buildTreasuryOptions(urgency: "routine" | "urgent"): MemorialOption[] {
  const opts = TREASURY_OPTIONS[urgency];
  return [
    { id: "audit", label: "清查侵耗", ...opts.audit },
    { id: "surtax", label: "加征田赋", ...opts.surtax },
    { id: "defer", label: "暂缓办理", ...opts.defer },
  ];
}

/**
 * 生成一条财政奏折（户部年度岁入计划）。每年四月生成一次，同源（sourceId）去重。
 * treasury < 3000 → urgent；否则 → routine。
 * 如有 pending 财政奏折（同年或历史遗留）则不重复生成。
 * 不合格返回 null（不抛）。
 */
export function generateTreasuryMemorial(
  state: GameState,
  at: GameTime,
): { state: GameState; memorial: Memorial } | null {
  const sourceId = `treasury:annual_revenue_plan:${at.year}`;
  if (hasMemorialForSource(state, sourceId)) return null;

  // Gate: 不得存在另一条 pending 财政奏折（避免积压）
  const hasPendingTreasury = Object.values(state.memorials).some(
    (m) => m.status === "pending" && m.category === "treasury",
  );
  if (hasPendingTreasury) return null;

  const urgency = state.resources.nation.treasury < 3000 ? "urgent" : "routine";
  const title = urgency === "urgent" ? "国库支绌请筹饷" : "户部奏请整饬岁入";
  const summary =
    urgency === "urgent"
      ? "国库支绌，户部告急，请陛下裁示筹饷之策。"
      : "岁入岁出勉强相符，户部请旨整饬财源。";

  const options = buildTreasuryOptions(urgency);
  const memorial: Memorial = {
    id: nextMemorialId(state),
    category: "treasury",
    status: "pending",
    createdAt: at,
    sourceId,
    title,
    summary,
    payload: { category: "treasury", matter: "annual_revenue_plan", urgency, options },
  };
  return {
    state: { ...state, memorials: { ...state.memorials, [memorial.id]: memorial } },
    memorial,
  };
}

/**
 * 年度财政奏折生成 seam（生产可达）：每年四月在 settleCalendarAdvance 中调用一次。
 * 幂等：同源去重保证本年只生成一次。
 */
export function maybeGenerateAnnualTreasuryMemorial(state: GameState, at: GameTime): GameState {
  return generateTreasuryMemorial(state, at)?.state ?? state;
}

// ── 军务奏折（Phase 4C）────────────────────────────────────────────────────────

/** 军务奏折各选项国库消耗常量（负值=支出；undefined=无变化）。 */
const MILITARY_COSTS = {
  annual_readiness: {
    drill:           { treasuryDelta: -600 as const },
    repair_armories: { treasuryDelta: -800 as const },
    defer_readiness: { treasuryDelta: undefined },
  },
  border_fortification: {
    fortify_passes:  { treasuryDelta: -1200 as const },
    rotate_garrison: { treasuryDelta: -700 as const },
    local_levy:      { treasuryDelta: undefined },
  },
  frontier_incursion: {
    urgent: {
      mobilize:  { treasuryDelta: -1800 as const },
      hold_line: { treasuryDelta: -1200 as const },
      negotiate: { treasuryDelta: -600 as const },
    },
    critical: {
      mobilize:  { treasuryDelta: -2800 as const },
      hold_line: { treasuryDelta: -1800 as const },
      negotiate: { treasuryDelta: -1000 as const },
    },
  },
} as const;

/** 兵备整饬（annual_readiness, routine）三选项。 */
function buildAnnualReadinessOptions(): MemorialOption[] {
  return [
    {
      id: "drill",
      label: "操练兵丁",
      effects: [
        res("nation", "military", 5),
        res("nation", "borderPressure", -2),
        res("nation", "productivity", -1),
      ],
      treasuryDelta: MILITARY_COSTS.annual_readiness.drill.treasuryDelta,
    },
    {
      id: "repair_armories",
      label: "修葺武库",
      effects: [
        res("nation", "military", 3),
        res("nation", "governance", 2),
        res("nation", "corruption", -1),
      ],
      treasuryDelta: MILITARY_COSTS.annual_readiness.repair_armories.treasuryDelta,
    },
    {
      id: "defer_readiness",
      label: "暂缓整备",
      effects: [
        res("nation", "military", -2),
        res("nation", "borderPressure", 3),
        res("nation", "rumor", 1),
      ],
    },
  ];
}

/** 边防加固（border_fortification, routine）三选项。 */
function buildBorderFortificationOptions(): MemorialOption[] {
  return [
    {
      id: "fortify_passes",
      label: "增修关隘",
      effects: [
        res("nation", "borderPressure", -7),
        res("nation", "military", 2),
        res("nation", "productivity", -2),
      ],
      treasuryDelta: MILITARY_COSTS.border_fortification.fortify_passes.treasuryDelta,
    },
    {
      id: "rotate_garrison",
      label: "轮戍边军",
      effects: [
        res("nation", "military", 5),
        res("nation", "borderPressure", -4),
        res("nation", "ministerLoyalty", -1),
      ],
      treasuryDelta: MILITARY_COSTS.border_fortification.rotate_garrison.treasuryDelta,
    },
    {
      id: "local_levy",
      label: "就地募兵",
      effects: [
        res("nation", "military", 4),
        res("nation", "borderPressure", -2),
        res("nation", "publicSupport", -5),
        res("nation", "productivity", -3),
      ],
    },
  ];
}

/** 边境入侵（frontier_incursion）三选项，按紧急度分档。 */
function buildFrontierIncursionOptions(urgency: "urgent" | "critical"): MemorialOption[] {
  const costs = MILITARY_COSTS.frontier_incursion[urgency];
  if (urgency === "urgent") {
    return [
      {
        id: "mobilize",
        label: "调兵出征",
        effects: [
          res("nation", "military", 6),
          res("nation", "borderPressure", -8),
          res("nation", "publicSupport", -2),
          res("sovereign", "fatigue", 2),
        ],
        treasuryDelta: costs.mobilize.treasuryDelta,
      },
      {
        id: "hold_line",
        label: "坚守待援",
        effects: [
          res("nation", "military", 3),
          res("nation", "borderPressure", -5),
          res("nation", "productivity", -3),
          res("nation", "governance", 1),
        ],
        treasuryDelta: costs.hold_line.treasuryDelta,
      },
      {
        id: "negotiate",
        label: "遣使议和",
        effects: [
          res("nation", "borderPressure", -4),
          res("sovereign", "prestige", -3),
          res("nation", "rumor", 2),
        ],
        treasuryDelta: costs.negotiate.treasuryDelta,
      },
    ];
  }
  // critical
  return [
    {
      id: "mobilize",
      label: "调兵出征",
      effects: [
        res("nation", "military", 8),
        res("nation", "borderPressure", -10),
        res("nation", "publicSupport", -3),
        res("sovereign", "fatigue", 3),
      ],
      treasuryDelta: costs.mobilize.treasuryDelta,
    },
    {
      id: "hold_line",
      label: "坚守待援",
      effects: [
        res("nation", "military", 4),
        res("nation", "borderPressure", -7),
        res("nation", "productivity", -4),
        res("nation", "governance", 1),
      ],
      treasuryDelta: costs.hold_line.treasuryDelta,
    },
    {
      id: "negotiate",
      label: "遣使议和",
      effects: [
        res("nation", "borderPressure", -6),
        res("sovereign", "prestige", -5),
        res("sovereign", "regimeSecurity", -2),
        res("nation", "rumor", 3),
      ],
      treasuryDelta: costs.negotiate.treasuryDelta,
    },
  ];
}

function matterFromSeverity(severity: FrontierSeverity): MilitaryMemorialMatter {
  if (severity === "stable") return "annual_readiness";
  if (severity === "watch") return "border_fortification";
  return "frontier_incursion";
}

function urgencyFromSeverity(severity: FrontierSeverity): MilitaryMemorialUrgency {
  if (severity === "stable" || severity === "watch") return "routine";
  if (severity === "urgent") return "urgent";
  return "critical";
}

const THEATER_DISPLAY: Record<FrontierTheaterId, string> = {
  northern_frontier: "北境",
  western_frontier:  "西陲",
  southern_frontier: "南疆",
};

function militaryTitle(
  matter: MilitaryMemorialMatter,
  urgency: MilitaryMemorialUrgency,
  theaterId: FrontierTheaterId,
): string {
  const name = THEATER_DISPLAY[theaterId];
  if (matter === "annual_readiness") return `兵部奏请整饬${name}边备`;
  if (matter === "border_fortification") return `${name}边镇奏请增修关防`;
  if (urgency === "urgent") return `${name}边军急奏敌骑犯境`;
  return `${name}八百里军报边关告急`;
}

function militarySummary(
  matter: MilitaryMemorialMatter,
  urgency: MilitaryMemorialUrgency,
  theaterId: FrontierTheaterId,
): string {
  const name = THEATER_DISPLAY[theaterId];
  if (matter === "annual_readiness") return `${name}边备入档，兵部请旨核定年度整饬方略。`;
  if (matter === "border_fortification") return `${name}边镇告警，敌情活跃，请陛下裁示增修关防。`;
  if (urgency === "urgent") return `${name}急报：敌骑犯境，请陛下即刻裁示应对之策。`;
  return `${name}八百里加急：边关告急，形势危殆，请陛下紧急裁示。`;
}

/** 按 matter + urgency 返回对应选项集。 */
function buildMilitaryOptions(
  matter: MilitaryMemorialMatter,
  urgency: MilitaryMemorialUrgency,
): MemorialOption[] {
  if (matter === "annual_readiness") return buildAnnualReadinessOptions();
  if (matter === "border_fortification") return buildBorderFortificationOptions();
  // frontier_incursion: urgency is "urgent" | "critical"（never "routine" for this matter）
  return buildFrontierIncursionOptions(urgency as "urgent" | "critical");
}

/** 军务奏折各 matter 所要求的选项 id 集（供校验 exact match）。 */
export const MILITARY_OPTION_IDS: Record<MilitaryMemorialMatter, string[]> = {
  annual_readiness:    ["drill", "repair_armories", "defer_readiness"],
  border_fortification:["fortify_passes", "rotate_garrison", "local_levy"],
  frontier_incursion:  ["mobilize", "hold_line", "negotiate"],
};

/**
 * 生成一条军务奏折。检查：年份一致、同源去重、无 pending 军务奏折、快照有效。
 * 任一条件不满足返回 null（不抛）。
 */
export function generateMilitaryMemorial(
  state: GameState,
  assessment: FrontierAssessmentPlan,
  at: GameTime,
): { state: GameState; memorial: Memorial } | null {
  // 1. 年份一致
  if (at.year !== assessment.year) return null;

  const matter = matterFromSeverity(assessment.severity);
  const urgency = urgencyFromSeverity(assessment.severity);
  const sourceId = `military:${matter}:${assessment.theaterId}:${assessment.year}`;

  // 2. 同源去重（pending 或 resolved 均算已存在）
  if (hasMemorialForSource(state, sourceId)) return null;

  // 3. 不得存在其他 pending 军务奏折
  const hasPendingMilitary = Object.values(state.memorials).some(
    (m) => m.status === "pending" && m.payload.category === "military",
  );
  if (hasPendingMilitary) return null;

  // 4. 快照值合法（0–100）
  if (
    assessment.pressureAfter < 0 || assessment.pressureAfter > 100 ||
    assessment.militaryAtAssessment < 0 || assessment.militaryAtAssessment > 100
  ) return null;

  const id = nextMemorialId(state);
  const options = buildMilitaryOptions(matter, urgency);
  const memorial: Memorial = {
    id,
    category: "military",
    status: "pending",
    createdAt: at,
    sourceId,
    title: militaryTitle(matter, urgency, assessment.theaterId),
    summary: militarySummary(matter, urgency, assessment.theaterId),
    payload: {
      category: "military",
      matter,
      urgency,
      theaterId: assessment.theaterId,
      pressureAtCreation: assessment.pressureAfter,
      militaryAtCreation: assessment.militaryAtAssessment,
      options,
    },
  };
  return {
    state: { ...state, memorials: { ...state.memorials, [id]: memorial } },
    memorial,
  };
}

/**
 * 年度边情评估 seam（生产可达）：经 funnel 应用 borderPressure 漂移 → 生成军务奏折 → 追加评估记录。
 * 幂等：本年已有评估则直接返回原 state。
 */
export function applyAnnualFrontierAssessment(
  state: GameState,
  db: ContentDB,
  at: GameTime,
): GameState {
  // 1. 幂等检查
  if (hasFrontierAssessmentForYear(state, at.year)) return state;

  // 2. 规划（纯函数，null = 已有本年记录，理论上不应再次进入）
  const plan = planFrontierAssessment(state, at);
  if (!plan) return state;

  // 3. 应用 borderPressure 漂移（经 funnel，尊重 AXIS_CAP；失败则沿用原 state，不硬失败）
  let pressureUpdated = state;
  const pressureEffect: EventEffect = {
    type: "resource",
    pillar: "nation",
    field: "borderPressure",
    delta: plan.pressureDelta,
  };
  const effectResult = applyEffects(db, state, [pressureEffect], { sceneId: "frontier_assessment" });
  if (effectResult.ok) {
    pressureUpdated = effectResult.value;
  } else {
    console.warn("[applyAnnualFrontierAssessment] borderPressure effect failed:", effectResult.error);
  }

  // 4. 生成军务奏折
  const memorialResult = generateMilitaryMemorial(pressureUpdated, plan, at);

  // 5. 构造 generation 字段
  let generation: FrontierAssessment["generation"];
  if (memorialResult) {
    generation = { status: "generated", memorialId: memorialResult.memorial.id };
    pressureUpdated = memorialResult.state;
  } else {
    // 被已有 pending 军务奏折阻拦
    const pendingMilitary = Object.values(pressureUpdated.memorials).find(
      (m) => m.status === "pending" && m.payload.category === "military",
    );
    if (!pendingMilitary) {
      // 不应出现（同源重复或快照异常）：跳过追加评估记录，仅返回 pressureUpdated
      return pressureUpdated;
    }
    generation = { status: "blocked_by_pending", blockingMemorialId: pendingMilitary.id };
  }

  // 6. 追加 FrontierAssessment 记录
  const assessment: FrontierAssessment = {
    id: plan.id,
    year: plan.year,
    assessedAt: plan.assessedAt,
    theaterId: plan.theaterId,
    pressureBefore: plan.pressureBefore,
    pressureDelta: plan.pressureDelta,
    pressureAfter: plan.pressureAfter,
    militaryAtAssessment: plan.militaryAtAssessment,
    governanceAtAssessment: plan.governanceAtAssessment,
    publicSupportAtAssessment: plan.publicSupportAtAssessment,
    severity: plan.severity,
    generation,
  };

  return {
    ...pressureUpdated,
    frontierAssessments: [...pressureUpdated.frontierAssessments, assessment],
  };
}

/**
 * 年度军务奏折生成便捷入口（与 maybeGenerateAnnualTreasuryMemorial 命名一致）。
 * 同 applyAnnualFrontierAssessment。
 */
export function maybeGenerateAnnualMilitaryAssessment(
  state: GameState,
  db: ContentDB,
  at: GameTime,
): GameState {
  return applyAnnualFrontierAssessment(state, db, at);
}

// ── 奏折批阅 ─────────────────────────────────────────────────────────────────

export interface ResolveMemorialResult {
  state: GameState;
}

/**
 * 原子批阅一条奏折：验证 pending → 验证 optionId 合法 → 若 option.treasuryDelta 存在则先执行 treasury 事务
 * → 经 funnel 施加该选项后果 → 标记 resolved。任一步失败返回 err，输入 state 不变（不施后果、不标 resolved）。
 * 绝不先 resolve 再执行后果。
 */
export function resolveMemorial(
  state: GameState,
  db: ContentDB,
  memId: string,
  optionId: string,
  at: GameTime,
): Result<ResolveMemorialResult, GameError> {
  const m = state.memorials[memId];
  if (!m) return err(stateError("MEMORIAL_NOT_FOUND", `无此奏折「${memId}」`, { context: { memId } }));
  if (m.status !== "pending")
    return err(stateError("MEMORIAL_ALREADY_RESOLVED", `奏折「${memId}」已批阅`, { context: { memId, status: m.status } }));

  const option = m.payload.options.find((o) => o.id === optionId);
  if (!option)
    return err(stateError("MEMORIAL_BAD_OPTION", `选项「${optionId}」不属于奏折「${memId}」`, { context: { memId, optionId } }));

  // Step 4: 若选项有国库变动，先执行 treasury 事务（失败则整体失败，输入 state 不变）
  let workingState = state;
  if (option.treasuryDelta !== undefined) {
    const txResult = applyTreasuryTransaction(workingState, {
      delta: option.treasuryDelta,
      at,
      source: { kind: "memorial", memorialId: memId, optionId },
      reason: option.label,
    });
    if (!txResult.ok) {
      // 将 TREASURY_INSUFFICIENT 映射为 MEMORIAL_TREASURY_INSUFFICIENT；其他 code 原样传出
      const mapCode =
        txResult.error.code === "TREASURY_INSUFFICIENT" ? "MEMORIAL_TREASURY_INSUFFICIENT" : txResult.error.code;
      return err(stateError(mapCode, txResult.error.message, { context: txResult.error.context }));
    }
    workingState = txResult.value.state;
  }

  // Step 5: 应用 resource effects（失败时 workingState 仅存于局部变量，输入 state 保持不变）
  const applied = applyEffects(db, workingState, option.effects as EventEffect[], { sceneId: "memorial" });
  if (!applied.ok) return err(applied.error[0]!);
  workingState = applied.value;

  // Step 6: 标记 resolved，返回最终 state
  const resolved: Memorial = { ...m, status: "resolved", resolvedAt: at, resolution: optionId };
  return ok({ state: { ...workingState, memorials: { ...workingState.memorials, [m.id]: resolved } } });
}

/** 待批阅奏折（按 id 稳定排序，UI 展示用）。 */
export function getPendingMemorials(state: GameState): Memorial[] {
  return Object.values(state.memorials)
    .filter((m) => m.status === "pending")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * 奏折集合完整性校验（key/去重/类别一致/状态-裁断一致/载荷）。纯函数，供 load 与测试复用。
 * 通用规则（所有类别）：选项非空、optionId 唯一、treasuryDelta 非零安全整数（若存在）。
 * 类别专属：disaster → regionId 已知；treasury → matter/urgency/必需选项。
 */
export function validateMemorials(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const e = (code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, message, context ? { context } : undefined));

  const seenSource = new Set<string>();
  for (const [key, m] of Object.entries(state.memorials)) {
    if (m.id !== key)
      e("MEMORIAL_KEY_MISMATCH", `memorials["${key}"].id = "${m.id}"（键不一致）`, { key, id: m.id });
    if (seenSource.has(m.sourceId))
      e("MEMORIAL_DUP_SOURCE", `奏折来源「${m.sourceId}」重复`, { id: m.id, sourceId: m.sourceId });
    seenSource.add(m.sourceId);
    if (m.category !== m.payload.category)
      e("MEMORIAL_CATEGORY_MISMATCH", `奏折「${m.id}」category「${m.category}」≠ payload「${m.payload.category}」`, { id: m.id });

    // 通用：选项非空、optionId 唯一、treasuryDelta 合法（所有类别）。
    const options = m.payload.options;
    if (options.length === 0) e("MEMORIAL_NO_OPTIONS", `奏折「${m.id}」无可选项`, { id: m.id });
    const optIds = new Set<string>();
    for (const o of options) {
      if (optIds.has(o.id)) e("MEMORIAL_DUP_OPTION", `奏折「${m.id}」选项 id「${o.id}」重复`, { id: m.id });
      optIds.add(o.id);
      if (o.treasuryDelta !== undefined) {
        if (!Number.isSafeInteger(o.treasuryDelta) || o.treasuryDelta === 0) {
          e(
            "MEMORIAL_BAD_TREASURY_DELTA",
            `奏折「${m.id}」选项「${o.id}」treasuryDelta「${o.treasuryDelta}」非非零安全整数`,
            { id: m.id, optionId: o.id, treasuryDelta: o.treasuryDelta },
          );
        }
      }
    }

    // disaster 专属：地域已知。
    if (m.payload.category === "disaster") {
      if (!DISASTER_REGIONS[m.payload.regionId])
        e("MEMORIAL_BAD_REGION", `奏折「${m.id}」regionId「${m.payload.regionId}」非已知地域`, { id: m.id });
    }

    // treasury 专属：matter/urgency/必需选项。
    if (m.payload.category === "treasury") {
      const treasuryMatter = m.payload.matter as string;
      if (treasuryMatter !== "annual_revenue_plan")
        e("MEMORIAL_BAD_MATTER", `奏折「${m.id}」matter「${treasuryMatter}」非法`, { id: m.id });
      if (m.payload.urgency !== "routine" && m.payload.urgency !== "urgent")
        e("MEMORIAL_BAD_URGENCY", `奏折「${m.id}」urgency「${m.payload.urgency}」非法`, { id: m.id });
      const presentIds = new Set(m.payload.options.map((o) => o.id));
      for (const req of TREASURY_OPTION_IDS) {
        if (!presentIds.has(req))
          e("MEMORIAL_MISSING_OPTION", `奏折「${m.id}」缺少必需选项「${req}」`, { id: m.id, missing: req });
      }
      // 不允许多余选项（exact match）。
      const TREASURY_REQUIRED = new Set(TREASURY_OPTION_IDS);
      for (const opt of m.payload.options) {
        if (!TREASURY_REQUIRED.has(opt.id as typeof TREASURY_OPTION_IDS[number])) {
          e("MEMORIAL_EXTRA_OPTION", `财政奏折「${m.id}」包含多余选项「${opt.id}」`, { id: m.id, extraOption: opt.id });
        }
      }
    }

    // military 专属：matter / urgency / theaterId / 快照 / 选项集精确匹配。
    if (m.payload.category === "military") {
      const p = m.payload;

      const VALID_MATTERS: ReadonlySet<string> = new Set<MilitaryMemorialMatter>([
        "annual_readiness", "border_fortification", "frontier_incursion",
      ]);
      if (!VALID_MATTERS.has(p.matter))
        e("MEMORIAL_BAD_MATTER", `军务奏折「${m.id}」matter「${p.matter}」非法`, { id: m.id });

      const VALID_URGENCIES: ReadonlySet<string> = new Set<MilitaryMemorialUrgency>([
        "routine", "urgent", "critical",
      ]);
      if (!VALID_URGENCIES.has(p.urgency))
        e("MEMORIAL_BAD_URGENCY", `军务奏折「${m.id}」urgency「${p.urgency}」非法`, { id: m.id });

      const VALID_THEATERS: ReadonlySet<string> = new Set<FrontierTheaterId>([
        "northern_frontier", "western_frontier", "southern_frontier",
      ]);
      if (!VALID_THEATERS.has(p.theaterId))
        e("MEMORIAL_BAD_THEATER", `军务奏折「${m.id}」theaterId「${p.theaterId}」非法`, { id: m.id });

      if (!Number.isInteger(p.pressureAtCreation) || p.pressureAtCreation < 0 || p.pressureAtCreation > 100)
        e("MEMORIAL_BAD_SNAPSHOT", `军务奏折「${m.id}」pressureAtCreation「${p.pressureAtCreation}」不在 0–100`, { id: m.id });

      if (!Number.isInteger(p.militaryAtCreation) || p.militaryAtCreation < 0 || p.militaryAtCreation > 100)
        e("MEMORIAL_BAD_SNAPSHOT", `军务奏折「${m.id}」militaryAtCreation「${p.militaryAtCreation}」不在 0–100`, { id: m.id });

      // matter↔urgency 约束
      if (p.matter === "annual_readiness" && p.urgency !== "routine")
        e("MEMORIAL_MATTER_URGENCY_MISMATCH", `军务奏折「${m.id}」annual_readiness 要求 urgency=routine，实为「${p.urgency}」`, { id: m.id });
      if (p.matter === "border_fortification" && p.urgency !== "routine")
        e("MEMORIAL_MATTER_URGENCY_MISMATCH", `军务奏折「${m.id}」border_fortification 要求 urgency=routine，实为「${p.urgency}」`, { id: m.id });
      if (p.matter === "frontier_incursion" && p.urgency !== "urgent" && p.urgency !== "critical")
        e("MEMORIAL_MATTER_URGENCY_MISMATCH", `军务奏折「${m.id}」frontier_incursion 要求 urgency=urgent/critical，实为「${p.urgency}」`, { id: m.id });

      // 选项集精确匹配
      if (VALID_MATTERS.has(p.matter)) {
        const expected = new Set(MILITARY_OPTION_IDS[p.matter as MilitaryMemorialMatter]);
        const present = new Set(p.options.map((o) => o.id));
        for (const req of expected) {
          if (!present.has(req))
            e("MEMORIAL_MISSING_OPTION", `军务奏折「${m.id}」缺少必需选项「${req}」`, { id: m.id, missing: req });
        }
        for (const opt of p.options) {
          if (!expected.has(opt.id))
            e("MEMORIAL_EXTRA_OPTION", `军务奏折「${m.id}」包含多余选项「${opt.id}」`, { id: m.id, extraOption: opt.id });
        }
      }

      // effects fields：nation/sovereign 字段合法性
      const NATION_FIELDS = new Set([
        "military", "treasury", "publicSupport", "productivity", "governance",
        "consortClanPower", "ministerLoyalty", "corruption", "clanDiscontent",
        "rumor", "borderPressure",
      ]);
      const SOVEREIGN_FIELDS = new Set([
        "health", "diligence", "prestige", "martial", "statecraft",
        "cruelty", "fatigue", "regimeSecurity",
      ]);
      for (const opt of p.options) {
        for (const eff of opt.effects) {
          const validSet = eff.pillar === "nation" ? NATION_FIELDS : SOVEREIGN_FIELDS;
          if (!validSet.has(eff.field))
            e("MEMORIAL_BAD_EFFECT_FIELD", `军务奏折「${m.id}」选项「${opt.id}」effect field「${eff.field}」(pillar=${eff.pillar})不合法`, {
              id: m.id, optionId: opt.id, pillar: eff.pillar, field: eff.field,
            });
        }
      }
    }

    // pending/resolved 一致性 + resolution ∈ 合法选项 + resolvedAt ≥ createdAt。
    if (m.status === "pending") {
      if (m.resolvedAt !== undefined || m.resolution !== undefined)
        e("MEMORIAL_PENDING_WITH_RESOLUTION", `待批奏折「${m.id}」不应带 resolvedAt/resolution`, { id: m.id });
    } else {
      if (m.resolvedAt === undefined || m.resolution === undefined) {
        e("MEMORIAL_RESOLVED_MISSING_FIELDS", `已批奏折「${m.id}」缺 resolvedAt/resolution`, { id: m.id });
      } else {
        if (!m.payload.options.some((o) => o.id === m.resolution))
          e("MEMORIAL_BAD_RESOLUTION", `奏折「${m.id}」resolution「${m.resolution}」非合法选项`, { id: m.id });
        if (compareGameTime(m.resolvedAt, m.createdAt) < 0)
          e("MEMORIAL_RESOLVED_BEFORE_CREATED", `奏折「${m.id}」resolvedAt 早于 createdAt`, { id: m.id });
      }
    }
  }
  return errors;
}
