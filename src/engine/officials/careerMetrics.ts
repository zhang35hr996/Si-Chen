/**
 * 官员能力与铨选评分（Phase 3 PR3C-1）：为在任官员建模静态能力 aptitude + 动态履历 reviewState，并提供
 * 家族势力 familyBacking 与升迁评分 promotionScore。**纯函数、确定性，不发生任何职位变化、不改 UI**。
 * 年度考课与自动升降（PR3C-2）、人事事件与官员 PUNISH（PR3C-3）在此之上。
 */
import type { CalendarState } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { GameState, Official, OfficialAptitude, OfficialReviewState } from "../state/types";
import { gestationRoll } from "../characters/gestation";
import { candidatePostFit } from "./fit";

/** 政绩初值。 */
export const INITIAL_MERIT = 50;
/** 年资满分对应的在任年数（≥ 此年数计满分）。 */
export const SENIORITY_FULL_YEARS = 10;

/** 新官员/回填官员的初始履历。 */
export function initialReviewState(): OfficialReviewState {
  return { merit: INITIAL_MERIT, underperformanceYears: 0 };
}

/**
 * 现有/开局官员的确定性四维能力回填（与候补同范围 20–95）。仅由稳定 seed 计算一次并存盘——
 * 读档绝不重算（值已物化于 Official.aptitude）。候补授官转正者直接继承候补能力，不走此函数。
 */
export function deriveOfficialAptitude(officialId: string, rngSeed: number): OfficialAptitude {
  const dim = (k: string) => 20 + (gestationRoll(`official:aptitude:${k}:${officialId}:${rngSeed}`) % 76);
  return { governance: dim("gov"), scholarship: dim("sch"), military: dim("mil"), integrity: dim("int") };
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/**
 * 当前官职任职年数。衡量的是「当前在任官职」的年资——故仅 active 且确占官职（postId 非空）才计；
 * 无职/退休/下狱/流放一律 0（这些状态下 appointedAt 仍保留「最近一次任职」时刻，不应继续累计）。
 */
export function seniorityYears(official: Official, calendar: Pick<CalendarState, "year">): number {
  if (official.status !== "active" || official.postId === null || !official.appointedAt) return 0;
  return Math.max(0, calendar.year - official.appointedAt.year);
}
/** 年资归一化 0–100（SENIORITY_FULL_YEARS 年计满）。 */
export function seniorityScore(official: Official, calendar: Pick<CalendarState, "year">): number {
  return clamp100((seniorityYears(official, calendar) / SENIORITY_FULL_YEARS) * 100);
}

/**
 * 后宫位分归一化分 0–100，**按位分序位**而非 order 比例——content 的 order 非等距（凤后 order=1000
 * 是礼制特殊值，直接除会把其余位分压扁到 <20）。最低位≈0、中位≈50、最高位（凤后）=100，保留相对排序。
 * 其它系统需要位分标准化时统一复用本函数，勿再对 order 直接做比例。
 */
export function haremRankScore(db: ContentDB, rankId: string): number {
  const ranks = Object.values(db.ranks).filter((r) => r.domain === "harem").sort((a, b) => a.order - b.order);
  if (ranks.length <= 1) return ranks.length === 1 && ranks[0]!.id === rankId ? 100 : 0;
  const idx = ranks.findIndex((r) => r.id === rankId);
  return idx < 0 ? 0 : (idx / (ranks.length - 1)) * 100;
}

/** 单名侍君的支持分：位分 0.60 + 恩宠 0.40（0–100）。 */
function consortScore(state: GameState, db: ContentDB, consortId: string): number {
  const st = state.standing[consortId];
  if (!st) return 0;
  return haremRankScore(db, st.rank) * 0.6 + clamp100(st.favor) * 0.4;
}

/**
 * 家族势力 0–100（实时派生，不把恩宠永久复制进官员字段）：
 * 家族 influence 0.55 + imperialFavor 0.15 + 后宫支持 0.30；后宫支持只取贡献最大两名侍君
 * （次者明显衰减），仅认明确 familyId 关联，无侍君则后宫支持为 0。
 */
export function familyBacking(state: GameState, db: ContentDB, familyId: string): number {
  const fam = state.officialFamilies[familyId];
  if (!fam) return 0;
  const scores = Object.entries(state.standing)
    .filter(([, s]) => s.birthFamilyId === familyId && s.lifecycle !== "deceased")
    .map(([id]) => consortScore(state, db, id))
    .sort((a, b) => b - a);
  const consortBacking = (scores[0] ?? 0) * 0.75 + (scores[1] ?? 0) * 0.25;
  return clamp100(fam.influence * 0.55 + fam.imperialFavor * 0.15 + consortBacking * 0.3);
}

/** 目标品级权重斜率 g：品级越高 g 越大（年资权重降、能力/政绩/家世权重升）。 */
export function gradeWeightFactor(targetGradeOrder: number): number {
  return Math.max(0, Math.min(1, (targetGradeOrder - 1) / 17));
}

/**
 * 升迁评分 0–100（确定性、纯函数；权重随目标品级 g 线性变化，两端各项和恒为 1）：
 * postFit*(0.25+0.10g) + merit*(0.20+0.15g) + seniority*(0.40−0.35g) + loyalty*0.10 + familyBacking*(0.05+0.10g)。
 * PR3C-1 只计算评分，不据此发生任何任免（自动升降留 PR3C-2）。
 */
export function promotionScore(
  state: GameState,
  db: ContentDB,
  official: Official,
  targetPost: { department: import("../state/types").OfficialDepartment; gradeOrder: number },
): number {
  const g = gradeWeightFactor(targetPost.gradeOrder);
  const fit = candidatePostFit(official, targetPost);
  const merit = clamp100(official.reviewState.merit);
  const sen = seniorityScore(official, state.calendar);
  const loyalty = clamp100(official.loyalty);
  const backing = familyBacking(state, db, official.familyId);
  const score =
    fit * (0.25 + 0.1 * g) +
    merit * (0.2 + 0.15 * g) +
    sen * (0.4 - 0.35 * g) +
    loyalty * 0.1 +
    backing * (0.05 + 0.1 * g);
  return clamp100(score);
}
