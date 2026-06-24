/**
 * 科举与候补官员池（Phase 3 PR3A）：每年二月生成本年度科举榜单与候补者；候补池随年增龄、逾期/退出。
 * 纯函数、确定性（种子 `official:exam:<year>:<rngSeed>` 等，与其它随机流隔离）。候补者**不是官员**：
 * 不占官位、不入官员名册、不参与官员年度告老、非 eligible 者不被任命源选中。女性限定。
 *
 * PR3A 只做数据底座：生成 + 存活/退出 + selectors/校验；不做职位匹配评分、任命、UI（留 PR3B）。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type {
  ExaminationResult,
  GameState,
  OfficialCandidate,
} from "../state/types";
import { gestationRoll } from "../characters/gestation";
import { naturalDeathChance } from "./lifecycleRules";
import { OFFICIAL_GIVEN_NAME_POOL, OFFICIAL_SURNAME_POOL } from "./namePool";

/** 科举时序：每年二月上旬生成（避开正月 lifecycle 与四月大选）。 */
export const EXAM_MONTH = 2;
/** 候补有效期（年）：入榜后 N 年内可授官，第 N 年起 expired。 */
export const CANDIDATE_ELIGIBLE_YEARS = 5;
/** 候补退出年龄上限（超过即退出竞争）。 */
export const CANDIDATE_WITHDRAW_AGE = 70;
const CANDIDATE_MIN_AGE = 18;
const CANDIDATE_FRESH_AGE_SPAN = 13; // 18–30
const MAX_RUNTIME_AGE = 120;
/** 关联已有官员家族的概率（百分）；否则寒门无背景（familyId=null）。 */
const FAMILY_LINK_CHANCE = 40;

/** 综合分（确定性，按才学/政略/清正/军事加权）。 */
export function examScore(a: OfficialCandidate["aptitude"]): number {
  return a.scholarship * 0.45 + a.governance * 0.25 + a.integrity * 0.2 + a.military * 0.1;
}

function pickAptitude(seed: string): OfficialCandidate["aptitude"] {
  const dim = (k: string) => 20 + (gestationRoll(`${seed}:${k}`) % 76); // 20–95
  return { governance: dim("gov"), scholarship: dim("sch"), military: dim("mil"), integrity: dim("int") };
}

/**
 * 生成某年度科举：4–8 名候补，确定性能力/家世，按综合分排名。绝不修改在任 officials。
 * 关联已有家族时只取 surname/familyId，不伪造新亲缘边；无背景则 familyId=null。
 */
export function buildAnnualExamination(
  state: GameState,
  _db: ContentDB,
  year: number,
  at: GameTime,
): { candidates: Record<string, OfficialCandidate>; result: ExaminationResult } {
  const base = `official:exam:${year}:${state.rngSeed}`;
  const count = 4 + (gestationRoll(`${base}:n`) % 5); // 4–8
  const familyIds = Object.keys(state.officialFamilies).sort();

  // 先按生成序建候补（不含 rank），再按综合分排名。
  const drafts: OfficialCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const s = `${base}:candidate:${i}`;
    const aptitude = pickAptitude(s);
    let familyId: string | null = null;
    let surname: string;
    if (familyIds.length > 0 && gestationRoll(`${s}:link`) % 100 < FAMILY_LINK_CHANCE) {
      familyId = familyIds[gestationRoll(`${s}:fam`) % familyIds.length]!;
      surname = state.officialFamilies[familyId]!.surname;
    } else {
      surname = OFFICIAL_SURNAME_POOL[gestationRoll(`${s}:sur`) % OFFICIAL_SURNAME_POOL.length]!;
    }
    drafts.push({
      id: `cand_${year}_${i}`,
      surname,
      givenName: OFFICIAL_GIVEN_NAME_POOL[gestationRoll(`${s}:given`) % OFFICIAL_GIVEN_NAME_POOL.length]!,
      age: CANDIDATE_MIN_AGE + (gestationRoll(`${s}:age`) % CANDIDATE_FRESH_AGE_SPAN),
      familyId,
      origin: "examination",
      examinationYear: year,
      examinationRank: 0, // 排名后填
      aptitude,
      status: "eligible",
      enteredPoolAt: at,
      expiresAtYear: year + CANDIDATE_ELIGIBLE_YEARS,
    });
  }

  // 综合分降序排名（同分按生成序稳定）。
  const ranked = drafts
    .map((c, idx) => ({ c, idx, score: examScore(c.aptitude) }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  const candidates: Record<string, OfficialCandidate> = {};
  const candidateIds: string[] = [];
  ranked.forEach((r, rank) => {
    const c = { ...r.c, examinationRank: rank + 1 };
    candidates[c.id] = c;
    candidateIds.push(c.id);
  });

  return { candidates, result: { year, generatedAt: at, candidateIds, acknowledged: false } };
}

/**
 * 候补池年度推进：eligible 增龄 → 逾年限 expired / 年龄上限或自然死亡 withdrawn。
 * 非 eligible（appointed/expired/withdrawn）冻结。纯函数、确定性。
 */
export function buildCandidateYearlyTick(state: GameState, year: number): GameState {
  let changed = false;
  const next: Record<string, OfficialCandidate> = {};
  for (const [id, c] of Object.entries(state.officialCandidates)) {
    if (c.status !== "eligible") { next[id] = c; continue; }
    const age = Math.min(c.age + 1, MAX_RUNTIME_AGE);
    let status: OfficialCandidate["status"] = "eligible";
    if (age >= CANDIDATE_WITHDRAW_AGE || gestationRoll(`official:exam:withdraw:${year}:${id}`) < naturalDeathChance(age)) {
      status = "withdrawn";
    } else if (year >= c.expiresAtYear) {
      status = "expired";
    }
    next[id] = { ...c, age, status };
    changed = true;
  }
  return changed ? { ...state, officialCandidates: next } : state;
}

/** 该年度科举是否已生成（幂等守卫）。 */
export function hasGeneratedExaminationForYear(state: GameState, year: number): boolean {
  return state.examinationResults.some((r) => r.year === year);
}

// ── 只读 selectors（不做授官资格/职位匹配判断——留 PR3B） ────────────────
/** 仍在候补池可授官者（status=eligible）。 */
export function getEligibleOfficialCandidates(state: GameState): OfficialCandidate[] {
  return Object.values(state.officialCandidates).filter((c) => c.status === "eligible");
}

/** 某年度科举的候补者（按榜次升序）。 */
export function getCandidatesByExaminationYear(state: GameState, year: number): OfficialCandidate[] {
  return Object.values(state.officialCandidates)
    .filter((c) => c.examinationYear === year)
    .sort((a, b) => a.examinationRank - b.examinationRank);
}

export function getCandidateById(state: GameState, id: string): OfficialCandidate | undefined {
  return state.officialCandidates[id];
}

/** 最近一届科举榜单（按年份取最大）。 */
export function getLatestExaminationResult(state: GameState): ExaminationResult | undefined {
  return state.examinationResults.reduce<ExaminationResult | undefined>(
    (latest, r) => (latest === undefined || r.year > latest.year ? r : latest),
    undefined,
  );
}

/** 候补池规模（eligible 人数）。 */
export function getCandidatePoolCount(state: GameState): number {
  return getEligibleOfficialCandidates(state).length;
}

/**
 * 二月统一结算：先候补池增龄/退出，再生成本年科举（仅当本年未生成）。幂等。
 * 由日历边界结算在跨入二月（或其后首次推进，catch-up）时调用一次。
 */
export function settleAnnualExamination(state: GameState, db: ContentDB, year: number, at: GameTime): GameState {
  if (hasGeneratedExaminationForYear(state, year)) return state;
  const aged = buildCandidateYearlyTick(state, year);
  const { candidates, result } = buildAnnualExamination(aged, db, year, at);
  return {
    ...aged,
    officialCandidates: { ...aged.officialCandidates, ...candidates },
    examinationResults: [...aged.examinationResults, result],
  };
}
