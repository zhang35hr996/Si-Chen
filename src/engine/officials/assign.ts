/**
 * 安全的官职任免入口（review F6 + PR2A §4）。绝不暴露能破坏席位不变量的裸 mutation：所有改职
 * 必须经此校验（官员存在、官职存在、席位未满、仅 active 可授官、幂等、null 去职），返回 Result。
 * 品级/权势由 postId 派生跟随。
 *
 * appointedAt 语义：记录「最近一次被授官的时刻」。实际授官/调任（null→post、postA→postB）写
 * appointedAt=at；幂等（null→null、同一非空 post）不更新；**去职（post→null）保留上次任职时刻，
 * 不清除**（appointedAt 表「最近一次任职」，非「当前是否在任」——是否在任看 postId/status）。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";

export function assignOfficialPost(
  state: GameState,
  db: ContentDB,
  officialId: string,
  newPostId: string | null,
  at: GameTime,
): Result<GameState, GameError> {
  const cur = state.officials[officialId];
  if (!cur) {
    return err(stateError("OFFICIAL_NOT_FOUND", `无此官员「${officialId}」`, { context: { officialId } }));
  }

  // 去职（null）：任何状态均允许；已为 null 则幂等。appointedAt 保留（上次任职时刻）。
  if (newPostId === null) {
    if (cur.postId === null) return ok(state);
    return ok({ ...state, officials: { ...state.officials, [officialId]: { ...cur, postId: null } } });
  }

  // 授官（非 null）：必须先确认 active，再做「同职幂等」与席位判定——
  // 否则非 active 官员若已非法占职，重分配同职会被幂等误放行。
  if (cur.status !== "active") {
    return err(stateError("OFFICIAL_NOT_ACTIVE", `非在任官员「${officialId}」(${cur.status}) 不可授官`, { context: { officialId, status: cur.status } }));
  }
  if (cur.postId === newPostId) return ok(state); // active 确认后才幂等（不更新 appointedAt）

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

  // 实际授官/调任：写 appointedAt。
  return ok({
    ...state,
    officials: { ...state.officials, [officialId]: { ...cur, postId: newPostId, appointedAt: at } },
  });
}
