/**
 * 候补授官相关只读 selectors（Phase 3 PR3B）：可授空缺、按适配度排序。纯查询——不修改 state、
 * 不消耗随机数、不自动授官。已 appointed/expired/withdrawn 候补绝不作为授官来源。
 */
import type { ContentDB } from "../content/loader";
import type { GameState, OfficialCandidate } from "../state/types";
import { getEligibleOfficialCandidates } from "./examination";
import { getVacantPosts } from "./selectors";
import { candidatePostFit } from "./fit";

export interface PostFitView {
  postId: string;
  vacantSeatCount: number;
  fit: number;
}

/** 某 eligible 候补可授任的空缺官职（按适配度降序；候补不存在或非 eligible 返回空）。 */
export function getVacantPostsForCandidate(state: GameState, db: ContentDB, candidateId: string): PostFitView[] {
  const cand = state.officialCandidates[candidateId];
  if (!cand || cand.status !== "eligible") return [];
  return getVacantPosts(state, db)
    .map((v) => {
      const post = db.officialPosts[v.postId]!;
      return { postId: v.postId, vacantSeatCount: v.vacantSeatCount, fit: candidatePostFit(cand, post) };
    })
    .sort((a, b) => b.fit - a.fit || (a.postId < b.postId ? -1 : 1)); // 同分按 postId 稳定
}

export interface CandidateFitView {
  candidate: OfficialCandidate;
  fit: number;
}

/** 对某官职，把 eligible 候补按适配度降序排（同分按榜次、再按 id 稳定）。 */
export function rankCandidatesForPost(state: GameState, db: ContentDB, postId: string): CandidateFitView[] {
  const post = db.officialPosts[postId];
  if (!post) return [];
  return getEligibleOfficialCandidates(state)
    .map((candidate) => ({ candidate, fit: candidatePostFit(candidate, post) }))
    .sort(
      (a, b) =>
        b.fit - a.fit ||
        a.candidate.examinationRank - b.candidate.examinationRank ||
        (a.candidate.id < b.candidate.id ? -1 : 1),
    );
}
