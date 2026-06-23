/**
 * 安全的官职任免入口（review F6）。本阶段不实现完整任命玩法，但绝不暴露能破坏席位不变量的
 * 裸 mutation：所有改职必须经此校验（官员存在、官职存在、席位未满、死者不可任职、幂等、
 * null 表示去职），返回 Result。品级/权势由 postId 派生跟随。
 */
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";

export function assignOfficialPost(
  state: GameState,
  db: ContentDB,
  officialId: string,
  newPostId: string | null,
): Result<GameState, GameError> {
  const cur = state.officials[officialId];
  if (!cur) {
    return err(stateError("OFFICIAL_NOT_FOUND", `无此官员「${officialId}」`, { context: { officialId } }));
  }
  if (cur.status === "dead") {
    return err(stateError("OFFICIAL_DEAD", `已故官员「${officialId}」不可任职`, { context: { officialId } }));
  }
  // 幂等：分配同一官职（含同为去职 null）即原样返回。
  if (cur.postId === newPostId) return ok(state);

  if (newPostId !== null) {
    const post = db.officialPosts[newPostId];
    if (!post) {
      return err(stateError("OFFICIAL_BAD_POST", `无此官职「${newPostId}」`, { context: { officialId, postId: newPostId } }));
    }
    const occupied = Object.values(state.officials).filter((o) => o.id !== officialId && o.postId === newPostId).length;
    if (occupied >= post.seatCount) {
      return err(
        stateError("OFFICIAL_SEAT_FULL", `官职「${newPostId}」席位已满（${occupied}/${post.seatCount}）`, {
          context: { officialId, postId: newPostId, occupied, seatCount: post.seatCount },
        }),
      );
    }
  }

  return ok({
    ...state,
    officials: { ...state.officials, [officialId]: { ...cur, postId: newPostId } },
  });
}
