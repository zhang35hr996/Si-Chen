/**
 * 皇嗣成长环境月度结算（PR4B）。每月一次、确定性、幂等，不依赖玩家是否打开毓庆宫/文昭殿。
 *
 * 闭环：养父照料能力 → 皇帝近期是否互动 → 忽视(neglect)与亲情(custodianBond)随时间变化。
 *
 *  - 无有效抚养人：忽视默认上升，皇帝近期互动可抵消/削弱；
 *  - 有有效抚养人：先按侍君性格/宫室算「照料倾向」careScore，再确定性掷出本月照料结果；
 *  - 养父禁足/冷宫/已故 → 本月按「无有效抚养人」处理（绝不清除法律抚养关系）；
 *  - 皇帝近期互动只**阻止/削弱新增忽视**，不再次降低忽视（召见已在紫宸殿即时降忽视）。
 *
 * 仅结算 alive 且年龄 < 18 的皇嗣。
 */
import { gestationRollRaw } from "./gestation";
import { heirAge } from "./heirs";
import { resolveConsortRuntimeAttrs } from "./consortAttrs";
import { resolveCustodianAvailability, custodianCanCareNow } from "./custodianAvailability";
import { monthOrdinal, type GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { GameState, Heir } from "../state/types";

export type HeirCareOutcome =
  | "imperial_attention"      // 无有效抚养人但皇帝近期亲询，护住了忽视
  | "attentive_custodian"     // 悉心照料
  | "ordinary_custodian"      // 日常照料
  | "inattentive_custodian"   // 偶有疏忽 / 明显冷落
  | "no_effective_custodian"; // 无人能亲自照料且皇帝久疏

export interface HeirUpbringingChange {
  heirId: string;
  neglectDelta: number;
  custodianBondDelta: number;
  careOutcome: HeirCareOutcome;
}

export interface HeirUpbringingPlan {
  periodKey: string;
  changes: HeirUpbringingChange[];
}

const UPBRINGING_MAX_AGE = 18;

/** 月键 "${year}:${pad2(month)}"。 */
export function upbringingMonthKey(now: Pick<GameTime, "year" | "month">): string {
  return `${now.year}:${String(now.month).padStart(2, "0")}`;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** 距上次皇帝互动的月数；从未互动返回 Infinity。 */
function monthsSinceImperialInteraction(heir: Heir, now: Pick<GameTime, "year" | "month">): number {
  if (!heir.lastImperialInteractionAt) return Infinity;
  return monthOrdinal(now) - monthOrdinal(heir.lastImperialInteractionAt);
}

/**
 * 皇帝近期互动对「本月新增忽视」的修正：
 *  - ≤1 月（本月或上月）：本月忽视最多不增加（neglectDelta 截到 ≤0）；
 *  - 2 月：忽视增量 −2；
 *  - ≥3 月或从未：无保护。
 * 只削弱新增，不主动降忽视（不再次减）。
 */
function applyImperialDamping(neglectDelta: number, monthsSince: number): number {
  if (monthsSince <= 1) return Math.min(neglectDelta, 0);
  if (monthsSince === 2) return neglectDelta - 2;
  return neglectDelta;
}

/**
 * 照料倾向 careScore（0–100 量级）：复用养父（侍君）性格与宫室，绝不用恩宠/位分/家世
 * （那些决定政治资源与伴读质量，不等同于「会不会爱孩子」）。
 */
function computeCareScore(db: ContentDB, state: GameState, custodianId: string, custodianBond: number): number {
  const attrs = resolveConsortRuntimeAttrs(db, state, custodianId);
  const { compassion, emotionalStability, sociability } = attrs.personality;
  const { servantOpinion, livingStandard } = attrs.household;
  return (
    compassion * 0.35 +
    emotionalStability * 0.20 +
    sociability * 0.10 +
    servantOpinion * 0.15 +
    livingStandard * 0.10 +
    custodianBond * 0.10
  );
}

type CareRoll = "attentive" | "ordinary" | "inattentive_mild" | "cold";

/**
 * 由 careScore 决定本月照料结果的概率分布。careScore 越高，悉心概率越高、冷落概率越低
 * （单调），但绝不保证每月最佳。阈值分档后在档内确定性掷骰。
 */
function rollCareResult(careScore: number, seed: string): CareRoll {
  const roll = gestationRollRaw(seed) % 100;
  let attentive: number, ordinary: number, mild: number;
  if (careScore >= 70) {
    [attentive, ordinary, mild] = [50, 85, 96];
  } else if (careScore >= 50) {
    [attentive, ordinary, mild] = [30, 70, 90];
  } else if (careScore >= 30) {
    [attentive, ordinary, mild] = [12, 45, 78];
  } else {
    [attentive, ordinary, mild] = [5, 30, 65];
  }
  if (roll < attentive) return "attentive";
  if (roll < ordinary) return "ordinary";
  if (roll < mild) return "inattentive_mild";
  return "cold";
}

const CARE_DELTAS: Record<CareRoll, { neglect: number; bond: number; outcome: HeirCareOutcome }> = {
  attentive: { neglect: -1, bond: +3, outcome: "attentive_custodian" },
  ordinary: { neglect: 0, bond: +1, outcome: "ordinary_custodian" },
  inattentive_mild: { neglect: +2, bond: 0, outcome: "inattentive_custodian" },
  cold: { neglect: +4, bond: -1, outcome: "inattentive_custodian" },
};

const NO_CUSTODIAN_BASE_NEGLECT = 6;

function planForHeir(
  db: ContentDB,
  state: GameState,
  heir: Heir,
  periodKey: string,
  now: Pick<GameTime, "year" | "month">,
): HeirUpbringingChange {
  const monthsSince = monthsSinceImperialInteraction(heir, now);
  const { custodianId, availability } = resolveCustodianAvailability(db, state, heir);
  const effectiveCustodian = custodianCanCareNow(availability) ? custodianId : undefined;

  if (!effectiveCustodian) {
    // 无有效抚养人（含养父暂时失效）：忽视默认上升，皇帝近期互动可抵消/削弱。
    const neglectDelta = applyImperialDamping(NO_CUSTODIAN_BASE_NEGLECT, monthsSince);
    const careOutcome: HeirCareOutcome =
      monthsSince <= 1 ? "imperial_attention" : "no_effective_custodian";
    return { heirId: heir.id, neglectDelta, custodianBondDelta: 0, careOutcome };
  }

  // 有有效抚养人：careScore → 概率结果 → 忽视/亲情增量；皇帝近期互动再削弱新增忽视。
  const careScore = computeCareScore(db, state, effectiveCustodian, heir.custodianBond);
  const seed = `heir-upbringing:${state.rngSeed}:${periodKey}:${heir.id}:${effectiveCustodian}`;
  const result = rollCareResult(careScore, seed);
  const { neglect, bond, outcome } = CARE_DELTAS[result];
  const neglectDelta = applyImperialDamping(neglect, monthsSince);
  return { heirId: heir.id, neglectDelta, custodianBondDelta: bond, careOutcome: outcome };
}

/** 计划本月成长环境结算。已结算本月则返回空 changes（幂等）。 */
export function planMonthlyHeirUpbringing(
  db: ContentDB,
  state: GameState,
  now: GameTime,
): HeirUpbringingPlan {
  const periodKey = upbringingMonthKey(now);
  if (state.settledHeirUpbringingMonths.includes(periodKey)) {
    return { periodKey, changes: [] };
  }
  const changes: HeirUpbringingChange[] = [];
  for (const heir of state.resources.bloodline.heirs) {
    if (heir.lifecycle !== "alive") continue;
    if (!heir.birthAt) continue;
    if (heirAge(heir, now) >= UPBRINGING_MAX_AGE) continue;
    changes.push(planForHeir(db, state, heir, periodKey, now));
  }
  return { periodKey, changes };
}

/**
 * 不可变应用：写入 neglect/custodianBond 增量（clamp 0–100），并登记月键。
 * 即便 changes 为空，也要登记月键以保证「本月已结算」幂等（除非本月已登记）。
 */
export function applyMonthlyHeirUpbringing(
  state: GameState,
  plan: HeirUpbringingPlan,
): GameState {
  if (state.settledHeirUpbringingMonths.includes(plan.periodKey)) return state;

  const deltaByHeir = new Map(plan.changes.map((c) => [c.heirId, c]));
  const heirs = state.resources.bloodline.heirs.map((h) => {
    const c = deltaByHeir.get(h.id);
    if (!c) return h;
    return {
      ...h,
      neglect: clampPct(h.neglect + c.neglectDelta),
      custodianBond: clampPct(h.custodianBond + c.custodianBondDelta),
    };
  });

  return {
    ...state,
    resources: {
      ...state.resources,
      bloodline: { ...state.resources.bloodline, heirs },
    },
    settledHeirUpbringingMonths: [...state.settledHeirUpbringingMonths, plan.periodKey],
  };
}
