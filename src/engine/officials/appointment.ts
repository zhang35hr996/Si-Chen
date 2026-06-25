/**
 * 候补授官（Phase 3 PR3B）：把 eligible 候补转正为正式 active 官员。唯一正式授官入口——UI 不得
 * 手工拼装 Official。原子（Result，失败 state 完全不变）：校验候补 eligible、官职存在有空席、未重复
 * 授官，创建正式 Official（确定性 loyalty，继承姓名/年龄/家族；寒门无家族则建最小家族壳），把候补置
 * appointed 并回填 appointedOfficialId，写 officialHistory（active + appointment 溯源）。
 *
 * 授官是行政行为，**不算惩罚**，绝不进入 PUNISH consequence；惩戒性降职/降品/免官（PR3C）才算惩罚。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState, Official, OfficialFamily, OfficialHistoryEntry } from "../state/types";
import { officialHistoryId } from "./lifecycle";
import { isPostVacant } from "./selectors";
import { initialReviewState } from "./careerMetrics";

/** 转正官员 id：稳定、可追溯候补、与既有 official_<famId> 命名空间隔离。 */
export function appointedOfficialId(candidateId: string): string {
  return `official_appointed_${candidateId}`;
}
/** 寒门（familyId=null）授官时建立的最小家族壳 id。 */
export function hanmenFamilyId(candidateId: string): string {
  return `official_fam_appointed_${candidateId}`;
}
/** 寒门家族壳的保守初始属性（无门第根基；不生成成员/亲缘）。 */
const HANMEN_INFLUENCE = 12;
const HANMEN_IMPERIAL_FAVOR = 10;

/**
 * 授官忠心（确定性，不调用随机流）：以清正为主、政略为辅，落在 0–100。
 * 透明可解释：integrity 高者初忠更高；后续政绩/事件再行升降。
 */
export function appointmentLoyalty(candidate: { aptitude: { integrity: number; governance: number } }): number {
  const raw = candidate.aptitude.integrity * 0.7 + candidate.aptitude.governance * 0.3;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function appointOfficialCandidate(
  state: GameState,
  db: ContentDB,
  candidateId: string,
  postId: string,
  at: GameTime,
): Result<GameState, GameError> {
  const cand = state.officialCandidates[candidateId];
  if (!cand) {
    return err(stateError("CANDIDATE_NOT_FOUND", `无此候补「${candidateId}」`, { context: { candidateId } }));
  }
  if (cand.status !== "eligible") {
    return err(stateError("CANDIDATE_NOT_ELIGIBLE", `候补「${candidateId}」当前为「${cand.status}」，不可授官`, {
      context: { candidateId, status: cand.status },
    }));
  }
  if (cand.appointedOfficialId) {
    return err(stateError("CANDIDATE_ALREADY_APPOINTED", `候补「${candidateId}」已授官`, { context: { candidateId } }));
  }

  // 官职须存在且为有品级官职（gradeOrder>0）——拒绝平民等非官职席位（与 getVacantPosts 一致）。
  const post = db.officialPosts[postId];
  if (!post || post.gradeOrder <= 0) {
    return err(stateError("OFFICIAL_BAD_POST", `无此官职或非授官席位「${postId}」`, { context: { candidateId, postId } }));
  }
  // 复用 PR2A 空缺判定，不另算占用人数。
  if (!isPostVacant(state, db, postId)) {
    return err(stateError("OFFICIAL_SEAT_FULL", `官职「${postId}」无空席`, { context: { candidateId, postId, seatCount: post.seatCount } }));
  }

  // 派生官员 id 须与所有人物命名空间全局唯一（与 validateOfficialWorld 的 id 唯一规则一致）。
  const officialId = appointedOfficialId(candidateId);
  const idTaken =
    !!db.characters[officialId] ||
    !!state.generatedConsorts[officialId] ||
    !!state.officials[officialId] ||
    !!state.familyMembers[officialId] ||
    (officialId in state.officialCandidates);
  if (idTaken) {
    return err(stateError("OFFICIAL_ID_COLLISION", `转正官员 id「${officialId}」已被占用`, { context: { candidateId, officialId } }));
  }

  // 家族：有关联则沿用（必须存在）；寒门（null）则建最小家族壳（仅 OfficialFamily，无成员/亲缘）。
  let officialFamilies = state.officialFamilies;
  let familyId: string;
  if (cand.familyId !== null) {
    if (!state.officialFamilies[cand.familyId]) {
      return err(stateError("CANDIDATE_BAD_FAMILY", `候补「${candidateId}」familyId「${cand.familyId}」无对应家族`, {
        context: { candidateId, familyId: cand.familyId },
      }));
    }
    familyId = cand.familyId;
  } else {
    familyId = hanmenFamilyId(candidateId);
    if (state.officialFamilies[familyId]) {
      return err(stateError("OFFICIAL_ID_COLLISION", `寒门家族壳 id「${familyId}」已存在`, { context: { candidateId, familyId } }));
    }
    const shell: OfficialFamily = { id: familyId, surname: cand.surname, influence: HANMEN_INFLUENCE, imperialFavor: HANMEN_IMPERIAL_FAVOR };
    officialFamilies = { ...state.officialFamilies, [familyId]: shell };
  }

  const official: Official = {
    id: officialId,
    surname: cand.surname,
    givenName: cand.givenName,
    postId,
    loyalty: appointmentLoyalty(cand),
    age: cand.age,
    familyId,
    status: "active",
    aptitude: cand.aptitude, // 原样继承候补能力
    reviewState: initialReviewState(),
    appointedAt: at,
  };

  const historyEntry: OfficialHistoryEntry = {
    id: officialHistoryId(state.officialHistory.length + 1),
    officialId,
    status: "active",
    at,
    appointment: {
      candidateId,
      examinationYear: cand.examinationYear,
      examinationRank: cand.examinationRank,
      postId,
      ageAtAppointment: cand.age,
    },
  };

  return ok({
    ...state,
    officialFamilies,
    officials: { ...state.officials, [officialId]: official },
    officialCandidates: {
      ...state.officialCandidates,
      [candidateId]: { ...cand, status: "appointed", appointedOfficialId: officialId },
    },
    officialHistory: [...state.officialHistory, historyEntry],
  });
}
