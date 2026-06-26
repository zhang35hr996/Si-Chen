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
import type { GameState, Memorial, MemorialOption, MemorialResourceEffect } from "../state/types";

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
      if (m.payload.matter !== "annual_revenue_plan")
        e("MEMORIAL_BAD_MATTER", `奏折「${m.id}」matter「${m.payload.matter}」非法`, { id: m.id });
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
