/**
 * 季度财政结算（Quarterly Treasury Settlement）。
 *
 * 每年四次触发（月份 1/4/7/10 上旬）：
 *   1. 计算季度税收与各支出分项（calculateQuarterlyRevenue / calculateQuarterlyExpense）
 *   2. 按优先级分配实付与缺口（allocateExpensePayments）
 *   3. 原子写入两条 system 台账条目（任一失败则整体回滚至原始 state）
 *   4. 生成一条财政简录奏折（matter: "quarterly_settlement_report"）供玩家阅览
 *
 * 幂等键存储于 state.settledQuarterlyPeriods，不依赖奏折是否存在。
 * 所有函数均为纯函数，不操作 store/React。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type {
  GameState,
  Memorial,
  MemorialOption,
  QuarterlyExpenseBreakdownFields,
  QuarterlyRevenueCause,
} from "../state/types";
import { applyTreasuryTransaction } from "./treasuryLedger";

// ── 常量 ───────────────────────────────────────────────────────────────────────

const BASE_QUARTERLY_REVENUE = 8000;

const MONTH_TO_SEASON: Record<number, string> = {
  1: "冬",
  4: "春",
  7: "夏",
  10: "秋",
};

const MONTH_TO_TITLE: Record<number, string> = {
  1: "冬税入库",
  4: "春税入库",
  7: "夏税入库",
  10: "秋税入库",
};

const PALACE_BASE_EXPENSE = 500;
const HEIR_EDUCATION_PER_CHILD = 100;

// ── 辅助 ───────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nextMemorialId(state: GameState): string {
  let maxSeq = 0;
  for (const id of Object.keys(state.memorials)) {
    const m = /^mem_(\d{6})$/.exec(id);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return `mem_${String(maxSeq + 1).padStart(6, "0")}`;
}

// ── 税收计算 ───────────────────────────────────────────────────────────────────

// Re-export so callers don't need to import from types.ts directly.
export type { QuarterlyRevenueCause as RevenueCause };

export interface QuarterlyRevenueResult {
  base: number;
  actual: number;
  ratio: number;
  /** 各因子归因列表（impact=0 的因子已过滤）。 */
  causes: QuarterlyRevenueCause[];
}

export function calculateQuarterlyRevenue(
  state: GameState,
  rng: () => number = Math.random,
): QuarterlyRevenueResult {
  const { productivity, corruption, publicSupport, borderPressure } = state.resources.nation;

  const productionFactor = clamp(0.5 + productivity / 100, 0.5, 1.5);
  const corruptionFactor = clamp(1.0 - corruption / 200, 0.5, 1.0);
  const stabilityFactor = clamp(0.8 + publicSupport / 500, 0.8, 1.1);
  const borderFactor = clamp(1.0 - borderPressure / 500, 0.8, 1.0);
  const randomFactor = 0.95 + rng() * 0.10;

  const base = BASE_QUARTERLY_REVENUE;
  const actual = Math.round(
    base * productionFactor * corruptionFactor * stabilityFactor * borderFactor * randomFactor,
  );

  // Each factor's impact: actual - (actual if this factor were replaced with 1.0)
  const withoutProduction = Math.round(base * 1.0 * corruptionFactor * stabilityFactor * borderFactor * randomFactor);
  const withoutCorruption = Math.round(base * productionFactor * 1.0 * stabilityFactor * borderFactor * randomFactor);
  const withoutStability = Math.round(base * productionFactor * corruptionFactor * 1.0 * borderFactor * randomFactor);
  const withoutBorder = Math.round(base * productionFactor * corruptionFactor * stabilityFactor * 1.0 * randomFactor);
  const withoutRandom = Math.round(base * productionFactor * corruptionFactor * stabilityFactor * borderFactor * 1.0);

  const causes: QuarterlyRevenueCause[] = (
    [
      { type: "productivity" as const, impact: actual - withoutProduction },
      { type: "corruption" as const, impact: actual - withoutCorruption },
      { type: "public_support" as const, impact: actual - withoutStability },
      { type: "border_pressure" as const, impact: actual - withoutBorder },
      { type: "random" as const, impact: actual - withoutRandom },
    ] satisfies QuarterlyRevenueCause[]
  ).filter((c) => c.impact !== 0);

  return { base, actual, ratio: actual / base, causes };
}

// ── 支出计算 ───────────────────────────────────────────────────────────────────

export interface QuarterlyExpenseBreakdown {
  total: number;
  breakdown: QuarterlyExpenseBreakdownFields;
}

export interface QuarterlyExpenseAllocation {
  planned: QuarterlyExpenseBreakdownFields;
  paid: QuarterlyExpenseBreakdownFields;
  shortfall: QuarterlyExpenseBreakdownFields;
}

/**
 * 按优先级分配有限预算。
 * 优先级：皇嗣教养 > 边军粮饷 > 百官俸禄 > 后宫月例 > 宫中用度。
 */
function allocateExpensePayments(
  planned: QuarterlyExpenseBreakdownFields,
  budget: number,
): QuarterlyExpenseAllocation {
  const priority: (keyof QuarterlyExpenseBreakdownFields)[] = [
    "royalChildrenEducation",
    "armyMaintenance",
    "officialSalary",
    "consortAllowance",
    "palace",
  ];

  let remaining = budget;
  const paid: QuarterlyExpenseBreakdownFields = {
    palace: 0, consortAllowance: 0, officialSalary: 0, armyMaintenance: 0, royalChildrenEducation: 0,
  };
  const shortfall: QuarterlyExpenseBreakdownFields = {
    palace: 0, consortAllowance: 0, officialSalary: 0, armyMaintenance: 0, royalChildrenEducation: 0,
  };

  for (const key of priority) {
    const p = planned[key];
    const paying = Math.min(p, remaining);
    paid[key] = paying;
    shortfall[key] = p - paying;
    remaining -= paying;
  }

  return { planned, paid, shortfall };
}

function computeConsortQuarterlyAllowance(db: ContentDB, state: GameState): number {
  const allChars = { ...db.characters, ...state.generatedConsorts };
  let total = 0;
  for (const char of Object.values(allChars)) {
    if (char.kind !== "consort") continue;
    const standing = state.standing[char.id];
    if (!standing) continue;
    const lifecycle = standing.lifecycle ?? "normal";
    if (lifecycle === "deceased" || lifecycle === "candidate") continue;
    const rank = db.ranks[standing.rank];
    if (!rank) continue;
    total += (rank.monthlyAllowance ?? 0) * 3;
  }
  return total;
}

export function calculateQuarterlyExpense(
  db: ContentDB,
  state: GameState,
): QuarterlyExpenseBreakdown {
  const { governance, military } = state.resources.nation;

  const palace = PALACE_BASE_EXPENSE;
  const officialSalary = Math.round(200 + governance * 3);
  const armyMaintenance = Math.round(300 + military * 5);
  const royalChildrenEducation =
    state.resources.bloodline.heirs.filter((h) => !h.deceasedAt).length * HEIR_EDUCATION_PER_CHILD;
  const consortAllowance = computeConsortQuarterlyAllowance(db, state);

  const total = palace + consortAllowance + officialSalary + armyMaintenance + royalChildrenEducation;
  return { total, breakdown: { palace, consortAllowance, officialSalary, armyMaintenance, royalChildrenEducation } };
}

// ── 奏报文本 ───────────────────────────────────────────────────────────────────

function buildRevenueText(
  ratio: number,
  actual: number,
  causes: QuarterlyRevenueCause[],
): string {
  const amount = actual.toLocaleString();

  if (ratio >= 1.1) {
    return (
      `启禀陛下，今季各州农桑兴旺，课征顺利，赋税俱已缴清。` +
      `今季共入库税银 **${amount} 两**。`
    );
  }
  if (ratio >= 0.85) {
    return `启禀陛下，各州税赋均已押解入京。今季共收税银 **${amount} 两**。`;
  }

  // Below 0.85: use dominant structural cause (exclude random noise)
  const negativeCauses = causes
    .filter((c) => c.impact < 0 && c.type !== "random")
    .sort((a, b) => a.impact - b.impact);
  const dominant = negativeCauses[0];

  let causeText = "各州税赋有所减少，";
  if (dominant) {
    switch (dominant.type) {
      case "corruption":
        causeText = "部分地方官员课税不清，恐有侵吞税款之事，";
        break;
      case "border_pressure":
        causeText = "边防费用繁重，各州余粮有限，";
        break;
      case "public_support":
        causeText = "民间颇有怨声，部分州县百姓难以足额完税，";
        break;
      case "productivity":
        causeText = "各州农桑稍欠，今年收成一般，";
        break;
    }
  }

  if (ratio >= 0.65) {
    return `启禀陛下，${causeText}今季赋税略减。共收税银 **${amount} 两**。`;
  }
  return `启禀陛下……${causeText}税赋难征。今季仅收税银 **${amount} 两**。`;
}

function buildExpenseText(
  expensePlanned: number,
  expensePaid: number,
  fundingShortfall: number,
  allocation: QuarterlyExpenseAllocation,
): string {
  if (fundingShortfall <= 0) {
    return (
      `另，今季宫中用度、百官俸禄、边军粮饷及皇嗣教养诸项，均已按例拨付，` +
      `共计支出 **${expensePaid.toLocaleString()} 两**。`
    );
  }

  // List which categories were short-funded
  const shortItems: string[] = [];
  if (allocation.shortfall.consortAllowance > 0) shortItems.push("后宫月例");
  if (allocation.shortfall.palace > 0) shortItems.push("宫中用度");
  if (allocation.shortfall.officialSalary > 0) shortItems.push("百官俸禄");
  if (allocation.shortfall.armyMaintenance > 0) shortItems.push("边军粮饷");
  if (allocation.shortfall.royalChildrenEducation > 0) shortItems.push("皇嗣教养");

  const itemsText = shortItems.join("、");
  return (
    `另，今季各项常例支出计划 **${expensePlanned.toLocaleString()} 两**，` +
    `因国库不足，实际拨付 **${expensePaid.toLocaleString()} 两**。` +
    `本季 **${itemsText}** 未能足额供给，` +
    `缺口合计 **${fundingShortfall.toLocaleString()} 两**。`
  );
}

function buildCommentary(state: GameState): string {
  const { productivity, corruption, publicSupport, borderPressure } = state.resources.nation;
  if (productivity > 65) return "各州生产兴旺，仓储较为充实。";
  if (corruption > 55) return "臣听闻部分州县税银征收不清，恐有官员侵吞。";
  if (publicSupport < 35) return "部分州县百姓已难按期完税。";
  if (borderPressure > 60) return "边军粮饷开支甚巨，各州盈余有限。";
  return "";
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────

/**
 * 季度财政结算主函数。
 *
 * 幂等：同一期号已在 state.settledQuarterlyPeriods 中则直接返回原始 state。
 * 原子：预计划所有金额后再依次写入台账；任一 applyTreasuryTransaction 失败则
 *       整体回滚（返回入参原始 state，不更新 settledQuarterlyPeriods）。
 */
export function settleQuarterlyTreasury(
  db: ContentDB,
  state: GameState,
  at: GameTime,
  rng: () => number = Math.random,
): GameState {
  const sourceId = `quarterly_settlement:${at.year}:${at.month}`;
  if (state.settledQuarterlyPeriods.includes(sourceId)) return state;

  const season = MONTH_TO_SEASON[at.month] ?? String(at.month);
  const title = `${MONTH_TO_TITLE[at.month] ?? "季税入库"}·季度财政简录`;
  const periodKey = `${at.year}:${at.month}`;

  // 1. Pre-plan: compute all amounts from original state
  const openingTreasury = state.resources.nation.treasury;
  const revenue = calculateQuarterlyRevenue(state, rng);
  const expense = calculateQuarterlyExpense(db, state);

  const treasuryAfterRevenue = openingTreasury + revenue.actual;
  const allocation = allocateExpensePayments(expense.breakdown, treasuryAfterRevenue);

  const expensePlanned = expense.total;
  const expensePaid = Object.values(allocation.paid).reduce((s, v) => s + v, 0);
  const fundingShortfall = expensePlanned - expensePaid;
  const closingTreasury = treasuryAfterRevenue - expensePaid;

  // 2. Apply income transaction; rollback to original state on failure
  let current = state;
  if (revenue.actual > 0) {
    const r = applyTreasuryTransaction(current, {
      delta: revenue.actual,
      at,
      source: { kind: "system", reasonCode: `quarterly_tax_income:${at.year}:${at.month}` },
      reason: `${season}税入库（${at.year}年${at.month}月）`,
    });
    if (!r.ok) return state;
    current = r.value.state;
  }

  // 3. Apply expense transaction; rollback to original state on failure
  if (expensePaid > 0) {
    const r = applyTreasuryTransaction(current, {
      delta: -expensePaid,
      at,
      source: { kind: "system", reasonCode: `quarterly_operating_expense:${at.year}:${at.month}` },
      reason: `季度固定支出（${at.year}年${at.month}月）`,
    });
    if (!r.ok) return state;
    current = r.value.state;
  }

  // 4. Generate informational memorial with full financial snapshot
  const revenueText = buildRevenueText(revenue.ratio, revenue.actual, revenue.causes);
  const expenseText = buildExpenseText(expensePlanned, expensePaid, fundingShortfall, allocation);
  const commentary = buildCommentary(state);

  const summary =
    `户部尚书奏报：\n\n` +
    revenueText +
    `\n\n` +
    expenseText +
    (commentary ? `\n\n${commentary}` : "");

  const acknowledgeOption: MemorialOption = { id: "acknowledge", label: "已阅", effects: [] };

  const memorial: Memorial = {
    id: nextMemorialId(current),
    category: "treasury",
    status: "pending",
    createdAt: at,
    sourceId,
    title,
    summary,
    payload: {
      category: "treasury",
      matter: "quarterly_settlement_report",
      season,
      periodKey,
      openingTreasury,
      revenueBase: revenue.base,
      revenueActual: revenue.actual,
      revenueCauses: revenue.causes,
      expensePlanned,
      expensePaid,
      fundingShortfall,
      expenseAllocation: allocation,
      closingTreasury,
      options: [acknowledgeOption],
    },
  };

  // 5. Mark period settled (independent of memorial existence)
  return {
    ...current,
    settledQuarterlyPeriods: [...current.settledQuarterlyPeriods, sourceId],
    memorials: { ...current.memorials, [memorial.id]: memorial },
  };
}
