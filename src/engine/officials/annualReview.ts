/**
 * 年度吏部考课与自动补缺（Phase 3 PR3C-2）：每年十一月一次，更新政绩 → 连年不合格自动降级 →
 * 自动升迁/连锁补缺 → 只读人事简报。纯函数、确定性、原子（失败不留半填官位表）。
 *
 * **全部为行政制度结果（authority: "system_review"），绝不进入 PUNISH consequence。** 皇帝亲自下令的
 * 惩戒性降职/降品/免官（PR3C-3）才算惩罚、走既有 PUNISH。本模块不调用任何惩罚系统、不写 punishmentId。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { OfficialPost } from "../content/schemas";
import type {
  AnnualReviewRecord,
  GameState,
  Official,
  OfficialHistoryEntry,
  PersonnelChange,
} from "../state/types";
import { gestationRoll } from "../characters/gestation";
import { officialHistoryId } from "./lifecycle";
import { candidatePostFit } from "./fit";
import { promotionScore, seniorityYears } from "./careerMetrics";
import { getEligibleOfficialCandidates } from "./examination";
import { appointOfficialCandidate } from "./appointment";
import { getLastHeldPostId, hasPendingRetirement, isPostVacant } from "./selectors";

/** 吏部考课月（十一月；避开正月 lifecycle、二月科举、四月大选）。 */
export const REVIEW_MONTH = 11;
const MERIT_QUALIFY_MIN = 35;
const FIT_QUALIFY_MIN = 30;
const PROMOTION_MERIT_MIN = 50;
const PROMOTION_SCORE_MIN = 65;
const MAX_PROMOTION_JUMP = 2; // 单次最多 +2 gradeOrder
const DEMOTION_TRIGGER_YEARS = 2; // 连续不合格年数阈值
/** 候补自动补缺的最高品级（高位空缺不自动塞新人，留空或由升迁链填）。 */
const CANDIDATE_ENTRY_GRADE_MAX = 8;
const MAX_VACANCY_ITERATIONS = 200; // 连锁补缺安全上限，禁止死循环

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const gradeOf = (db: ContentDB, postId: string | null): number =>
  postId ? (db.officialPosts[postId]?.gradeOrder ?? 0) : 0;

/** 当前在任官职的适配度（无职为 0）。 */
function currentPostFit(db: ContentDB, o: Official): number {
  const post = o.postId ? db.officialPosts[o.postId] : undefined;
  return post ? candidatePostFit(o, post) : 0;
}

/** 本年是否已考课（幂等守卫）。 */
export function hasReviewedYear(state: GameState, year: number): boolean {
  return state.annualReviews.some((r) => r.year === year);
}

// ── 1) 政绩更新（确定性 ±3，受适配度牵引；并更新连续不合格年数） ──────────────
/** 某官员本年度政绩增量（确定性，-3..+3；适配高者上行、低者下行）。 */
export function annualMeritDelta(o: Official, fit: number, year: number): number {
  const bias = Math.round((fit - 50) / 20); // 约 -2.5..+2.5
  const jitter = (gestationRoll(`official:review:${year}:${o.id}`) % 3) - 1; // -1..+1
  return Math.max(-3, Math.min(3, bias + jitter));
}

export function updateMerit(state: GameState, db: ContentDB, year: number): GameState {
  const officials: Record<string, Official> = { ...state.officials };
  for (const o of Object.values(state.officials)) {
    if (o.status !== "active") continue;
    const fit = currentPostFit(db, o);
    const merit = clamp100(o.reviewState.merit + annualMeritDelta(o, fit, year));
    const unqualified = merit < MERIT_QUALIFY_MIN || fit < FIT_QUALIFY_MIN;
    officials[o.id] = {
      ...o,
      reviewState: {
        merit,
        lastReviewedYear: year,
        underperformanceYears: unqualified ? o.reviewState.underperformanceYears + 1 : 0,
      },
    };
  }
  return { ...state, officials };
}

// ── 内部：受控移动（写 postId/appointedAt + officialHistory；席位安全由调用方保证空缺） ──
function moveOfficial(state: GameState, officialId: string, toPostId: string | null, at: GameTime): GameState {
  const cur = state.officials[officialId]!;
  const next: Official = {
    ...cur,
    postId: toPostId,
    ...(toPostId !== null ? { appointedAt: at } : {}),
  };
  const entry: OfficialHistoryEntry = {
    id: officialHistoryId(state.officialHistory.length + 1),
    officialId,
    status: "active",
    at,
    ...(cur.postId !== null ? { vacatedPostId: cur.postId } : {}),
  };
  return { ...state, officials: { ...state.officials, [officialId]: next }, officialHistory: [...state.officialHistory, entry] };
}

// ── 2) 连年不合格自动降级（system_review，不进 PUNISH） ──────────────────────
export function applyDemotions(state: GameState, db: ContentDB, at: GameTime): { state: GameState; changes: PersonnelChange[] } {
  let cur = state;
  const changes: PersonnelChange[] = [];
  // 确定性顺序：按 officialId。
  const targets = Object.values(state.officials)
    .filter((o) => o.status === "active" && o.postId !== null && o.reviewState.underperformanceYears >= DEMOTION_TRIGGER_YEARS)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const o of targets) {
    const fromGrade = gradeOf(db, o.postId);
    const drop = 1 + (gestationRoll(`official:demote:${at.year}:${o.id}`) % 2); // 1 或 2
    const targetGrade = fromGrade - drop;
    const fromPostId = o.postId;
    // 取空缺、品级 ≤ fromGrade-1 且最接近 targetGrade 的官职；无则释放为无职。
    const lower = Object.values(db.officialPosts)
      .filter((p) => p.gradeOrder > 0 && p.gradeOrder < fromGrade && isPostVacant(cur, db, p.id))
      .sort((a, b) => Math.abs(a.gradeOrder - targetGrade) - Math.abs(b.gradeOrder - targetGrade) || (a.id < b.id ? -1 : 1));
    const toPostId = lower[0]?.id ?? null;
    cur = moveOfficial(cur, o.id, toPostId, at);
    // 降级后清零连续不合格，给一次重新积累的机会。
    cur = { ...cur, officials: { ...cur.officials, [o.id]: { ...cur.officials[o.id]!, reviewState: { ...cur.officials[o.id]!.reviewState, underperformanceYears: 0 } } } };
    changes.push({ officialId: o.id, kind: "demotion", fromPostId, toPostId, authority: "system_review" });
  }
  return { state: cur, changes };
}

// ── 3) 自动升迁 + 连锁补缺（高品空缺优先；升迁链 → 候补；席位安全、确定性、有界） ──
interface Filler {
  kind: "promotion" | "fill" | "appointment";
  officialId?: string;
  candidateId?: string;
  score: number;
}

/** 为某空缺官职挑选最佳补缺者（不在 moved 内的在任官员或 eligible 候补）。 */
function bestFiller(state: GameState, db: ContentDB, post: OfficialPost, moved: Set<string>): Filler | null {
  const vacGrade = post.gradeOrder;
  let best: Filler | null = null;
  const better = (f: Filler) => { if (!best || f.score > best.score || (f.score === best.score && (f.officialId ?? f.candidateId ?? "") < (best.officialId ?? best.candidateId ?? ""))) best = f; };

  for (const o of Object.values(state.officials)) {
    if (o.status !== "active" || moved.has(o.id) || hasPendingRetirement(state, o.id)) continue;
    if (o.postId === post.id) continue;
    const refGrade = o.postId !== null ? gradeOf(db, o.postId) : gradeOf(db, getLastHeldPostId(state, o.id) ?? null);
    if (o.postId !== null) {
      // 升迁：目标须更高、且不超 +2；满足政绩/评分门槛、年资≥1。
      if (vacGrade <= refGrade || vacGrade > refGrade + MAX_PROMOTION_JUMP) continue;
      if (o.reviewState.merit < PROMOTION_MERIT_MIN) continue;
      if (seniorityYears(o, state.calendar) < 1) continue;
      const score = promotionScore(state, db, o, post);
      if (score < PROMOTION_SCORE_MIN) continue;
      better({ kind: "promotion", officialId: o.id, score });
    } else {
      // 无职在任补缺：不得跨越大量品级（≤ 最近任职品级 +2）。
      if (vacGrade > refGrade + MAX_PROMOTION_JUMP) continue;
      better({ kind: "fill", officialId: o.id, score: promotionScore(state, db, o, post) });
    }
  }
  // 候补授官（仅低品入仕）。
  if (vacGrade <= CANDIDATE_ENTRY_GRADE_MAX) {
    for (const c of getEligibleOfficialCandidates(state)) {
      if (moved.has(c.id)) continue;
      better({ kind: "appointment", candidateId: c.id, score: candidatePostFit(c, post) });
    }
  }
  return best;
}

export function resolveOfficialVacancies(state: GameState, db: ContentDB, at: GameTime): { state: GameState; changes: PersonnelChange[] } {
  let cur = state;
  const changes: PersonnelChange[] = [];
  const moved = new Set<string>(); // 每人/每候补本轮至多动一次
  const unfillable = new Set<string>(); // 本轮已确认无人可补的官职
  for (let iter = 0; iter < MAX_VACANCY_ITERATIONS; iter++) {
    const vac = Object.values(db.officialPosts)
      .filter((p) => p.gradeOrder > 0 && !unfillable.has(p.id) && isPostVacant(cur, db, p.id))
      .sort((a, b) => b.gradeOrder - a.gradeOrder || (a.id < b.id ? -1 : 1))[0];
    if (!vac) break;
    const filler = bestFiller(cur, db, vac, moved);
    if (!filler) { unfillable.add(vac.id); continue; }
    if (filler.kind === "appointment") {
      const r = appointOfficialCandidate(cur, db, filler.candidateId!, vac.id, at);
      if (!r.ok) { unfillable.add(vac.id); continue; } // 防御：理论不应失败
      cur = r.value;
      moved.add(filler.candidateId!);
      changes.push({ officialId: `official_appointed_${filler.candidateId}`, kind: "appointment", fromPostId: null, toPostId: vac.id, candidateId: filler.candidateId, authority: "system_review" });
    } else {
      const o = cur.officials[filler.officialId!]!;
      const fromPostId = o.postId;
      cur = moveOfficial(cur, filler.officialId!, vac.id, at);
      moved.add(filler.officialId!);
      changes.push({ officialId: filler.officialId!, kind: filler.kind, fromPostId, toPostId: vac.id, authority: "system_review" });
    }
  }
  return { state: cur, changes };
}

// ── 4) 编排：考课一年（幂等；本年仅一次） ──────────────────────────────────
export function buildAnnualReview(state: GameState, db: ContentDB, year: number, at: GameTime): GameState {
  if (hasReviewedYear(state, year)) return state;
  const merited = updateMerit(state, db, year);
  const demoted = applyDemotions(merited, db, at);
  const filled = resolveOfficialVacancies(demoted.state, db, at);
  const record: AnnualReviewRecord = { year, at, changes: [...demoted.changes, ...filled.changes] };
  return { ...filled.state, annualReviews: [...filled.state.annualReviews, record] };
}

/** 最近一年人事简报。 */
export function getLatestAnnualReview(state: GameState): AnnualReviewRecord | undefined {
  return state.annualReviews.reduce<AnnualReviewRecord | undefined>((m, r) => (m === undefined || r.year > m.year ? r : m), undefined);
}
