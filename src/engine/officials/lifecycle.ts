/**
 * 官员生命周期状态机（Phase 2 PR2A）。所有状态变化必须经此处的正式服务，绝不直接改
 * `official.status = …`。每个入口统一负责：释放官职席位（postId→null）、改状态、写时刻/原因、
 * 追加 officialHistory（可见历史）、撤回该官员未决告老、维持校验不变量，并保证原子性
 * （返回 Result，失败不改 state）。
 *
 * 任命复用 assignOfficialPost（不另建平行 appoint 系统）。restore* 只恢复状态、不自动授官：
 * 解除后 postId 仍为 null，须再走 assignOfficialPost（原席位可能已被他人占据）。
 * 死亡是终态且不删除人物——dead 仍是侍君生母/家族成员/历史人物。
 */
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameTime } from "../calendar/time";
import type {
  GameState,
  Official,
  OfficialHistoryEntry,
  OfficialStatus,
  OfficialStatusReason,
} from "../state/types";

export function officialHistoryId(seq: number): string {
  return `ohist_${String(seq).padStart(6, "0")}`;
}

interface TransitionOpts {
  /** 允许的来源状态。 */
  from: readonly OfficialStatus[];
  /** 该官职变化是否要求当前确占某官职（如罢免必须有职可罢）。 */
  requireSeated?: boolean;
}

/** 统一状态迁移：校验来源 → 释放席位 → 改状态 → 写历史 → 撤未决告老。 */
function applyTransition(
  state: GameState,
  officialId: string,
  newStatus: OfficialStatus,
  reason: OfficialStatusReason | undefined,
  at: GameTime,
  opts: TransitionOpts,
): Result<GameState, GameError> {
  const cur = state.officials[officialId];
  if (!cur) {
    return err(stateError("OFFICIAL_NOT_FOUND", `无此官员「${officialId}」`, { context: { officialId } }));
  }
  if (!opts.from.includes(cur.status)) {
    return err(stateError("OFFICIAL_BAD_TRANSITION", `官员「${officialId}」当前为「${cur.status}」，不可执行此变更`, {
      context: { officialId, from: cur.status, to: newStatus },
    }));
  }
  if (opts.requireSeated && cur.postId === null) {
    return err(stateError("OFFICIAL_NO_POST", `官员「${officialId}」当前无官职，无可释放席位`, { context: { officialId } }));
  }

  const vacatedPostId = cur.postId ?? undefined;
  const next: Official = {
    ...cur,
    postId: null, // 任何生命周期变更都释放席位；复职须另走 assignOfficialPost
    status: newStatus,
    statusChangedAt: at,
    statusReason: newStatus === "active" ? undefined : reason,
    ...(newStatus === "dead" ? { deathAt: at } : {}),
  };

  const entry: OfficialHistoryEntry = {
    id: officialHistoryId(state.officialHistory.length + 1),
    officialId,
    status: newStatus,
    ...(reason !== undefined ? { reason } : {}),
    at,
    ...(vacatedPostId !== undefined ? { vacatedPostId } : {}),
  };

  return ok({
    ...state,
    officials: { ...state.officials, [officialId]: next },
    officialHistory: [...state.officialHistory, entry],
    pendingRetirements: state.pendingRetirements.filter((p) => p.officialId !== officialId),
  });
}

/** 告老：在任 → retired。 */
export function retireOfficial(state: GameState, officialId: string, at: GameTime): Result<GameState, GameError> {
  return applyTransition(state, officialId, "retired", "retirement", at, { from: ["active"] });
}

/** 下狱：在任 → imprisoned。 */
export function imprisonOfficial(state: GameState, officialId: string, at: GameTime): Result<GameState, GameError> {
  return applyTransition(state, officialId, "imprisoned", "imprisonment", at, { from: ["active"] });
}

/** 流放：在任 → exiled。 */
export function exileOfficial(state: GameState, officialId: string, at: GameTime): Result<GameState, GameError> {
  return applyTransition(state, officialId, "exiled", "exile", at, { from: ["active"] });
}

/** 罢免：在任且有职 → 仍 active 但去职（保留为可再任用）。历史记 dismissal。 */
export function dismissOfficial(state: GameState, officialId: string, at: GameTime): Result<GameState, GameError> {
  return applyTransition(state, officialId, "active", "dismissal", at, { from: ["active"], requireSeated: true });
}

/** 死亡：任意非 dead → dead（自然死亡 / 处决）。终态，绝不删除人物。 */
export function markOfficialDead(
  state: GameState,
  officialId: string,
  reason: "natural_death" | "execution",
  at: GameTime,
): Result<GameState, GameError> {
  return applyTransition(state, officialId, "dead", reason, at, {
    from: ["active", "retired", "imprisoned", "exiled"],
  });
}

/** 复职为可任用：retired/imprisoned/exiled → active（postId 仍 null，须再 assignOfficialPost）。 */
export function restoreOfficialToActive(state: GameState, officialId: string, at: GameTime): Result<GameState, GameError> {
  return applyTransition(state, officialId, "active", undefined, at, {
    from: ["retired", "imprisoned", "exiled"],
  });
}
