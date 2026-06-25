/**
 * 人事决策的确定性生成（Phase 3 PR3C-3b）。三类玩法各有严格资格门 + 确定性目标选择：
 *
 * 1. `consort_petition_promotion` 侍君请求提拔亲族（行政升迁，**不入 PUNISH**）。
 * 2. `family_implication` 侍君获罪牵连家族（牵连=皇帝亲发惩戒，**入 PUNISH**）。
 * 3. `memorial_*` 紫宸殿人事奏折（荐升/请降/请免）。
 *
 * 生成器**只**产出待裁 PersonnelDecision，绝不直接改 postId / officialHistory / justice。实际职位变更全部
 * 在 resolvePersonnelDecision 经 promoteOfficialAdministratively / punishOfficial 正式 API 完成。
 * 全部确定性（无概率）：选择与 tie-break 稳定，测试可显式构造触发。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { GameState, Official, PersonnelDecision, PersonnelDecisionKind } from "../state/types";
import { getPunishment } from "../justice/selectors";
import { promotionScore } from "./careerMetrics";
import {
  getActiveSeatedOfficials,
  getOfficialsByFamilyId,
  isPostVacant,
} from "./selectors";

/** 单次升/降最多跨 2 品（与年度考课一致）。 */
const MAX_GRADE_JUMP = 2;
/** 牵连家族要求的最低侍君惩罚严重度。 */
const IMPLICATION_MIN_SEVERITY = new Set(["severe", "terminal"]);
/** 荐升奏折门槛（与年度考课升迁口径一致）。 */
const MEMORIAL_PROMOTION_MERIT_MIN = 55;
const MEMORIAL_PROMOTION_SCORE_MIN = 60;
/** 请降奏折门槛（政绩偏低即可建议，皇帝批准才入 PUNISH）。 */
const MEMORIAL_DEMOTION_MERIT_MAX = 35;
/** 请免奏折门槛（连年严重不合格）。 */
const MEMORIAL_DISMISSAL_UNDERPERFORM_YEARS = 2;

const gradeOf = (db: ContentDB, postId: string | null): number =>
  postId ? (db.officialPosts[postId]?.gradeOrder ?? 0) : 0;

/** "pdec_000001" 单调。决策永不删除（resolved 留存），故 count+1 无冲突。 */
export function personnelDecisionId(seq: number): string {
  return `pdec_${String(seq).padStart(6, "0")}`;
}

function nextDecisionId(state: GameState): string {
  return personnelDecisionId(Object.keys(state.personnelDecisions).length + 1);
}

/** 同一 sourceId 全局至多一条（无论 pending/resolved）。 */
export function hasDecisionForSource(state: GameState, sourceId: string): boolean {
  return Object.values(state.personnelDecisions).some((d) => d.sourceId === sourceId);
}

/** 某侍君是否已有待裁的提拔请求（同侍君同时只允许一条 pending 请求）。 */
function hasPendingPetition(state: GameState, consortId: string): boolean {
  return Object.values(state.personnelDecisions).some(
    (d) => d.status === "pending" && d.kind === "consort_petition_promotion" && d.consortId === consortId,
  );
}

/** 侍君与官员是否有明确亲缘边（绝不靠姓名推断）。 */
function hasDirectKinship(state: GameState, consortId: string, officialId: string): boolean {
  return state.kinship.some((k) => k.fromPersonId === consortId && k.toPersonId === officialId);
}

/** 侍君在宫且在世（资格前置）。 */
function consortEligible(state: GameState, consortId: string): boolean {
  const s = state.standing[consortId];
  return s !== undefined && s.lifecycle !== "deceased";
}

/**
 * 为某官员择「更高有空席」目标官职：品级在 (fromGrade, fromGrade+2] 内、有空缺；按 promotionScore 降序、
 * 再品级降序、再 postId 升序确定性取最优。无合法目标返回 null。
 */
export function selectHigherVacantPost(state: GameState, db: ContentDB, official: Official): string | null {
  const fromGrade = gradeOf(db, official.postId);
  const cands = Object.values(db.officialPosts)
    .filter((p) => p.gradeOrder > fromGrade && p.gradeOrder <= fromGrade + MAX_GRADE_JUMP && isPostVacant(state, db, p.id))
    .map((p) => ({ post: p, score: promotionScore(state, db, official, p) }))
    .sort((a, b) => b.score - a.score || b.post.gradeOrder - a.post.gradeOrder || (a.post.id < b.post.id ? -1 : 1));
  return cands[0]?.post.id ?? null;
}

/**
 * 为某官员择「更低有空席」目标官职：品级在 [fromGrade-2, fromGrade-1]（>0）内、有空缺；取最接近当前（最高品，
 * 降幅最小），再 postId 升序。无合法目标返回 null（UI 据此禁用降职选项）。
 */
export function selectLowerVacantPost(state: GameState, db: ContentDB, official: Official): string | null {
  const fromGrade = gradeOf(db, official.postId);
  const cands = Object.values(db.officialPosts)
    .filter((p) => p.gradeOrder > 0 && p.gradeOrder >= fromGrade - MAX_GRADE_JUMP && p.gradeOrder < fromGrade && isPostVacant(state, db, p.id))
    .sort((a, b) => b.gradeOrder - a.gradeOrder || (a.id < b.id ? -1 : 1));
  return cands[0]?.id ?? null;
}

/** 写入一条待裁决策（不做资格判断；调用方负责门控与去重）。 */
function appendDecision(
  state: GameState,
  fields: Omit<PersonnelDecision, "id" | "status" | "createdAt">,
  at: GameTime,
): { state: GameState; decision: PersonnelDecision } {
  const decision: PersonnelDecision = { id: nextDecisionId(state), status: "pending", createdAt: at, ...fields };
  return {
    state: { ...state, personnelDecisions: { ...state.personnelDecisions, [decision.id]: decision } },
    decision,
  };
}

/**
 * 事件 1：侍君请求提拔亲族。资格：侍君在宫在世、有母族、族中有 active+seated 官员、存在合法更高空缺、
 * 该侍君无 pending 请求、同源（侍君+官员+年度）未生成过。选官员：有合法升迁目标者中——明确亲缘优先 →
 * 当前品级最高 → promotionScore 最高 → officialId 稳定。无合法人选返回 null（不生成）。
 */
export function generateConsortPetition(
  state: GameState,
  db: ContentDB,
  consortId: string,
  at: GameTime,
): { state: GameState; decision: PersonnelDecision } | null {
  if (!consortEligible(state, consortId)) return null;
  if (hasPendingPetition(state, consortId)) return null;
  const familyId = state.standing[consortId]?.birthFamilyId;
  if (!familyId) return null;

  const seated = getOfficialsByFamilyId(state, familyId).filter((o) => o.status === "active" && o.postId !== null);
  const eligible = seated
    .map((o) => ({ o, target: selectHigherVacantPost(state, db, o) }))
    .filter((x): x is { o: Official; target: string } => x.target !== null)
    .sort((a, b) => {
      const ka = hasDirectKinship(state, consortId, a.o.id) ? 1 : 0;
      const kb = hasDirectKinship(state, consortId, b.o.id) ? 1 : 0;
      if (ka !== kb) return kb - ka;
      const ga = gradeOf(db, a.o.postId);
      const gb = gradeOf(db, b.o.postId);
      if (ga !== gb) return gb - ga;
      const sa = promotionScore(state, db, a.o, db.officialPosts[a.target]!);
      const sb = promotionScore(state, db, b.o, db.officialPosts[b.target]!);
      if (sa !== sb) return sb - sa;
      return a.o.id < b.o.id ? -1 : 1;
    });
  const pick = eligible[0];
  if (!pick) return null;

  const sourceId = `petition:${consortId}:${pick.o.id}:${at.year}`;
  if (hasDecisionForSource(state, sourceId)) return null;
  return appendDecision(
    state,
    {
      kind: "consort_petition_promotion",
      sourceId,
      officialId: pick.o.id,
      consortId,
      familyId,
      fromPostId: pick.o.postId!,
      recommendedPostId: pick.target,
    },
    at,
  );
}

/**
 * 事件 2：侍君获罪牵连家族。来源必须是已存在的**侍君** PunishmentRecord（targetKind=consort）且严重度
 * severe/terminal。资格：侍君有母族、族中有 active+seated 官员、同一 sourcePunishmentId 未生成过。选官员：
 * 同族 active+seated 中——当前品级最高 → 明确亲缘优先 → officialId 稳定。无在任族官返回 null（不生成）。
 * recommendedPostId 为更低空席（可能为 null：UI 降职选项禁用，但免官恒可用）。
 */
export function generateFamilyImplication(
  state: GameState,
  db: ContentDB,
  sourcePunishmentId: string,
  at: GameTime,
): { state: GameState; decision: PersonnelDecision } | null {
  const pun = getPunishment(state, sourcePunishmentId);
  if (!pun || pun.targetKind !== "consort" || !IMPLICATION_MIN_SEVERITY.has(pun.severity)) return null;
  const consortId = pun.targetId;
  const familyId = state.standing[consortId]?.birthFamilyId;
  if (!familyId) return null;

  const sourceId = `implication:${sourcePunishmentId}`;
  if (hasDecisionForSource(state, sourceId)) return null;

  const seated = getOfficialsByFamilyId(state, familyId)
    .filter((o) => o.status === "active" && o.postId !== null)
    .sort((a, b) => {
      const ga = gradeOf(db, a.postId);
      const gb = gradeOf(db, b.postId);
      if (ga !== gb) return gb - ga;
      const ka = hasDirectKinship(state, consortId, a.id) ? 1 : 0;
      const kb = hasDirectKinship(state, consortId, b.id) ? 1 : 0;
      if (ka !== kb) return kb - ka;
      return a.id < b.id ? -1 : 1;
    });
  const pick = seated[0];
  if (!pick) return null;

  const lower = selectLowerVacantPost(state, db, pick);
  return appendDecision(
    state,
    {
      kind: "family_implication",
      sourceId,
      officialId: pick.id,
      consortId,
      familyId,
      fromPostId: pick.postId!,
      ...(lower ? { recommendedPostId: lower } : {}),
      sourcePunishmentId,
      ...(pun.caseId ? { caseId: pun.caseId } : {}),
    },
    at,
  );
}

/** 奏折种类（紫宸殿人事）。 */
type MemorialKind = "memorial_promotion" | "memorial_demotion" | "memorial_dismissal";

/** 某官员是否满足某类奏折的生成条件（不含去重）。 */
function memorialEligible(state: GameState, db: ContentDB, o: Official, kind: MemorialKind): { target?: string } | null {
  if (o.status !== "active" || o.postId === null) return null;
  switch (kind) {
    case "memorial_promotion": {
      const target = selectHigherVacantPost(state, db, o);
      if (!target) return null;
      if (o.reviewState.merit < MEMORIAL_PROMOTION_MERIT_MIN) return null;
      if (promotionScore(state, db, o, db.officialPosts[target]!) < MEMORIAL_PROMOTION_SCORE_MIN) return null;
      return { target };
    }
    case "memorial_demotion": {
      const target = selectLowerVacantPost(state, db, o);
      if (!target) return null;
      if (o.reviewState.merit > MEMORIAL_DEMOTION_MERIT_MAX && o.reviewState.underperformanceYears < 1) return null;
      return { target };
    }
    case "memorial_dismissal": {
      if (o.reviewState.underperformanceYears < MEMORIAL_DISMISSAL_UNDERPERFORM_YEARS) return null;
      return {};
    }
  }
}

/**
 * 单条人事奏折生成（显式指定官员与种类；测试与生成器内部共用）。资格不足或同源（种类+官员+年度）已存在则
 * 返回 null。荐升/请降携 recommendedPostId；请免不携。
 */
export function generateMemorial(
  state: GameState,
  db: ContentDB,
  officialId: string,
  kind: MemorialKind,
  at: GameTime,
): { state: GameState; decision: PersonnelDecision } | null {
  const o = state.officials[officialId];
  if (!o) return null;
  const elig = memorialEligible(state, db, o, kind);
  if (!elig) return null;
  const sourceId = `memorial:${kind}:${officialId}:${at.year}`;
  if (hasDecisionForSource(state, sourceId)) return null;
  return appendDecision(
    state,
    {
      kind,
      sourceId,
      officialId,
      familyId: o.familyId,
      fromPostId: o.postId!,
      ...(elig.target ? { recommendedPostId: elig.target } : {}),
    },
    at,
  );
}

/** 待裁人事决策（按 id 稳定排序，UI 展示用）。 */
export function getPendingPersonnelDecisions(state: GameState): PersonnelDecision[] {
  return Object.values(state.personnelDecisions)
    .filter((d) => d.status === "pending")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 合法裁断集合（按 kind）。UI 与 resolver 共享，杜绝两处口径漂移。 */
export function legalResolutionsFor(kind: PersonnelDecisionKind): readonly PersonnelDecision["resolution"][] {
  return kind === "family_implication" ? ["spare", "demote", "dismiss"] : ["approve", "reject"];
}

/** 供 UI/生成器复用的活跃在任官员清单。 */
export function activeSeatedForMemorials(state: GameState, db: ContentDB): Official[] {
  return getActiveSeatedOfficials(state, db);
}

export type { MemorialKind };
