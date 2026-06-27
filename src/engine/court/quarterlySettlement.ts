/**
 * 季度财政结算（Quarterly Treasury Settlement）。
 *
 * 每年四次触发（月份 1/4/7/10 上旬）：
 *   1. 计算季度税收入库（calculateQuarterlyRevenue）
 *   2. 计算季度固定支出（calculateQuarterlyExpense）
 *   3. 原子写入两条 system 台账条目
 *   4. 生成一条财政简录奏折（matter: "quarterly_settlement_report"）供玩家阅览
 *
 * 所有函数均为纯函数，不操作 store/React。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { GameState, Memorial, MemorialOption } from "../state/types";
import { applyTreasuryTransaction } from "./treasuryLedger";
import { hasMemorialForSource } from "./memorials";

// ── 常量 ───────────────────────────────────────────────────────────────────────

/** 季度基础税收（两）。实际收入 = 基数 × 各因子乘积。 */
const BASE_QUARTERLY_REVENUE = 8000;

/** 月份 → 季节标签。 */
const MONTH_TO_SEASON: Record<number, string> = {
  1: "冬",
  4: "春",
  7: "夏",
  10: "秋",
};

/** 月份 → 奏折标题前缀。 */
const MONTH_TO_TITLE: Record<number, string> = {
  1: "冬税入库",
  4: "春税入库",
  7: "夏税入库",
  10: "秋税入库",
};

/** 季度固定支出：宫中基础用度。 */
const PALACE_BASE_EXPENSE = 500;

/** 每位存活皇嗣的季度教养费。 */
const HEIR_EDUCATION_PER_CHILD = 100;

// ── 辅助 ───────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** "mem_000001" 单调序号生成（与 memorials.ts 同逻辑，避免循环依赖）。 */
function nextMemorialId(state: GameState): string {
  let maxSeq = 0;
  for (const id of Object.keys(state.memorials)) {
    const m = /^mem_(\d{6})$/.exec(id);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return `mem_${String(maxSeq + 1).padStart(6, "0")}`;
}

// ── 税收计算 ───────────────────────────────────────────────────────────────────

export interface QuarterlyRevenueResult {
  base: number;
  actual: number;
  /** actual / base，用于文案分级。 */
  ratio: number;
}

/**
 * 计算本季度税收实收金额。
 * @param rng 随机源（默认 Math.random，测试可注入固定值）
 */
export function calculateQuarterlyRevenue(
  state: GameState,
  rng: () => number = Math.random,
): QuarterlyRevenueResult {
  const { productivity, corruption, publicSupport, borderPressure } = state.resources.nation;

  const productionFactor = clamp(0.5 + productivity / 100, 0.5, 1.5);
  const corruptionFactor = clamp(1.0 - corruption / 200, 0.5, 1.0);
  const stabilityFactor = clamp(0.8 + publicSupport / 500, 0.8, 1.1);
  const borderFactor = clamp(1.0 - borderPressure / 500, 0.8, 1.0);
  // 小范围随机波动：±5%
  const randomFactor = 0.95 + rng() * 0.10;

  const base = BASE_QUARTERLY_REVENUE;
  const actual = Math.round(
    base * productionFactor * corruptionFactor * stabilityFactor * borderFactor * randomFactor,
  );

  return { base, actual, ratio: actual / base };
}

// ── 支出计算 ───────────────────────────────────────────────────────────────────

export interface QuarterlyExpenseBreakdown {
  palace: number;
  consortAllowance: number;
  officialSalary: number;
  armyMaintenance: number;
  royalChildrenEducation: number;
}

export interface QuarterlyExpenseResult {
  total: number;
  breakdown: QuarterlyExpenseBreakdown;
}

/** 计算当季在籍侍君季度月例总额。 */
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

/** 计算季度固定支出。 */
export function calculateQuarterlyExpense(
  db: ContentDB,
  state: GameState,
): QuarterlyExpenseResult {
  const { governance, military } = state.resources.nation;

  const palace = PALACE_BASE_EXPENSE;
  const officialSalary = Math.round(200 + governance * 3);
  const armyMaintenance = Math.round(300 + military * 5);
  const royalChildrenEducation =
    state.resources.bloodline.heirs.filter((h) => !h.deceasedAt).length * HEIR_EDUCATION_PER_CHILD;
  const consortAllowance = computeConsortQuarterlyAllowance(db, state);

  const total = palace + consortAllowance + officialSalary + armyMaintenance + royalChildrenEducation;
  return {
    total,
    breakdown: { palace, consortAllowance, officialSalary, armyMaintenance, royalChildrenEducation },
  };
}

// ── 奏报文本 ───────────────────────────────────────────────────────────────────

function buildRevenueText(ratio: number, actual: number): string {
  const amount = actual.toLocaleString();
  if (ratio >= 1.1) {
    return (
      `启禀陛下，今年风调雨顺，百姓安居，农桑兴旺，各州赋税俱已缴清。` +
      `今季共入库税银 **${amount} 两**。` +
      `皆赖陛下圣德广被，四海升平。`
    );
  }
  if (ratio >= 0.85) {
    return `启禀陛下，各州税赋均已押解入京。今季共收税银 **${amount} 两**。`;
  }
  if (ratio >= 0.65) {
    return (
      `启禀陛下，部分州府遭逢灾害，今季赋税略减。` +
      `共收税银 **${amount} 两**。`
    );
  }
  return (
    `启禀陛下……多地流民四起，税赋难征。` +
    `今季仅收税银 **${amount} 两**。`
  );
}

function buildExpenseText(expenseTotal: number): string {
  return (
    `另，今季宫中用度、百官俸禄、边军粮饷及皇嗣教养诸项，均已按例拨付，` +
    `共计支出 **${expenseTotal.toLocaleString()} 两**。`
  );
}

function buildCommentary(state: GameState): string {
  const { productivity, corruption, publicSupport, borderPressure } = state.resources.nation;
  if (productivity > 65) return "各州仓廪充盈，民间颇称丰年。";
  if (corruption > 55) return "臣听闻部分州县税银征收不清，恐有官员侵吞。";
  if (publicSupport < 35) return "部分州县百姓已难按期完税。";
  if (borderPressure > 60) return "边军粮饷开支甚巨，各州盈余有限。";
  return "";
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────

/**
 * 季度财政结算主函数。
 *
 * 幂等：同一季度（year:month 组合）已结算则直接返回原始 state。
 * 顺序：税收入库 → 支出扣除（不足时扣至余额归零）→ 生成财政简录奏折。
 */
export function settleQuarterlyTreasury(
  db: ContentDB,
  state: GameState,
  at: GameTime,
  rng: () => number = Math.random,
): GameState {
  const sourceId = `quarterly_settlement:${at.year}:${at.month}`;
  if (hasMemorialForSource(state, sourceId)) return state;

  const season = MONTH_TO_SEASON[at.month] ?? String(at.month);
  const title = `${MONTH_TO_TITLE[at.month] ?? "季税入库"}·季度财政简录`;

  // 1. 计算税收与支出
  const revenue = calculateQuarterlyRevenue(state, rng);
  const expense = calculateQuarterlyExpense(db, state);

  let current = state;

  // 2. 入库（税收）
  if (revenue.actual > 0) {
    const r = applyTreasuryTransaction(current, {
      delta: revenue.actual,
      at,
      source: { kind: "system", reasonCode: `quarterly_tax_income:${at.year}:${at.month}` },
      reason: `${season}税入库（${at.year}年${at.month}月）`,
    });
    if (r.ok) current = r.value.state;
  }

  // 3. 支出（扣至余额归零）
  const actualExpense = Math.min(expense.total, current.resources.nation.treasury);
  if (actualExpense > 0) {
    const r = applyTreasuryTransaction(current, {
      delta: -actualExpense,
      at,
      source: { kind: "system", reasonCode: `quarterly_operating_expense:${at.year}:${at.month}` },
      reason: `季度固定支出（${at.year}年${at.month}月）`,
    });
    if (r.ok) current = r.value.state;
  }

  // 4. 生成财政简录奏折（仅供阅览，无国库变动）
  const revenueText = buildRevenueText(revenue.ratio, revenue.actual);
  const expenseText = buildExpenseText(actualExpense);
  const commentary = buildCommentary(current);

  const summary =
    `户部尚书奏报：\n\n` +
    revenueText +
    `\n\n` +
    expenseText +
    (commentary ? `\n\n${commentary}` : "");

  const acknowledgeOption: MemorialOption = {
    id: "acknowledge",
    label: "已阅",
    effects: [],
  };

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
      options: [acknowledgeOption],
    },
  };

  return {
    ...current,
    memorials: { ...current.memorials, [memorial.id]: memorial },
  };
}
