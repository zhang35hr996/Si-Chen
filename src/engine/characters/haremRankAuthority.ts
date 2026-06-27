/**
 * 六宫行政位分处分权（§IV-IX）。
 *
 * 三态权限：
 *   empress mode        → harem_administrator/office:empress（皇后以自身名义处分贵人以下侍君）
 *   acting_consort mode → harem_administrator（受限于自身位分与贵人边界，只能处分严格低于自己且低于贵人的侍君）
 *   neiwu_proxy mode    → none（内务府无位分处分权）
 *
 * 贵人边界：贵人及以上须陛下亲旨，六宫主理权仅覆盖贵人以下（严格，贵人本身不可被调整）。
 * 目标新位分上限为贵人（含），不可晋至贵人以上。
 *
 * 此模块不依赖 UI 层；可在 funnel.ts 验证中直接调用。
 */
import type { ContentDB } from "../content/loader";
import { isAssignableRank, type RankOperationAuthority } from "../content/schemas";
import type { GameState } from "../state/types";
import { isConfined } from "./confinement";

export type { RankOperationAuthority };

export type RankAuthority =
  | { kind: "sovereign"; actorId: "player"; maxTargetOrder: number }
  | { kind: "harem_administrator"; actorId: string; maxTargetOrder: number }
  | { kind: "none"; reason: string };

/**
 * 当前六宫行政位分处分权。
 *   empress mode        → harem_administrator（皇后以 charId 行使，maxTargetOrder = guiren.order - 1）
 *   acting_consort mode → harem_administrator（maxTargetOrder = min(actorOrder - 1, guiren.order - 1)）
 *   neiwu_proxy mode    → none（无权）
 */
export function getHaremRankAuthority(db: ContentDB, state: GameState): RankAuthority {
  const admin = state.haremAdministration;

  if (admin.mode === "neiwu_proxy") {
    return { kind: "none", reason: "内务府仅暂代宫务，无权议定侍君位分。" };
  }

  // 六宫主理权覆盖上限：贵人及以上须陛下亲旨，主理权只覆盖贵人以下。
  const guirenOrder = db.ranks["guiren"]?.order ?? 100;

  if (admin.mode === "empress") {
    // 皇后以自身名义行使处分权：找当前皇后 charId。
    const fenghouId = Object.keys(state.standing).find(
      (id) => state.standing[id]!.rank === "huanghou" && state.standing[id]!.lifecycle !== "deceased",
    );
    if (!fenghouId) {
      return { kind: "none", reason: "当前宫中无皇后，无法行使处分权。" };
    }
    return { kind: "harem_administrator", actorId: fenghouId, maxTargetOrder: guirenOrder - 1 };
  }

  // acting_consort：只能处分 order 严格低于自身且低于贵人的侍君。
  const charId = admin.charId;
  const st = state.standing[charId];
  if (!st) return { kind: "none", reason: "协理者资料异常。" };
  const actorOrder = db.ranks[st.rank]?.order ?? 0;
  if (actorOrder <= 0) return { kind: "none", reason: "协理者位分数据异常。" };
  return { kind: "harem_administrator", actorId: charId, maxTargetOrder: Math.min(actorOrder - 1, guirenOrder - 1) };
}

/**
 * 校验代理侍君能否对目标进行指定位分变更（含全部前置条件）。
 *
 * 权威判据为 state.haremAdministration.mode === "acting_consort"，不再要求皇后禁足。
 * PUNISH-3A 后合法委任包含 imperial_deprivation（健康皇后受罚）和 empress_illness（抱恙皇后）
 * 两种不要求禁足的路径，皇后禁足不再是协理者权限的必要条件。
 *
 * 必须同时满足：
 *  1. haremAdministration 为 acting_consort 且 actorId 匹配。
 *  2. actor 存活、未禁足、仍达到驸级门槛。
 *  3. target 非 actor 本人。
 *  4. target 非皇后。
 *  5. target 当前 rank.order < actor rank.order（严格低于）。
 *  6. target 当前 rank.order < guiren.order（贵人边界：贵人及以上须陛下亲旨）。
 *  7. newRankId 的 order < actor rank.order（晋升后仍低于协理者）。
 *  8. newRankId 的 order <= guiren.order（最高只能晋至贵人）。
 *  9. newRankId 不为 huanghou。
 */
export function canAdministratorAdjustRank(
  db: ContentDB,
  state: GameState,
  actorId: string,
  targetId: string,
  newRankId: string,
): { ok: true } | { ok: false; reason: string } {
  const admin = state.haremAdministration;
  if (admin.mode !== "acting_consort" || admin.charId !== actorId) {
    return { ok: false, reason: "行为者不是当前六宫协理者。" };
  }
  if (actorId === targetId) {
    return { ok: false, reason: "协理者不能调整自己的位分。" };
  }

  // actor 自身状态。
  const actorSt = state.standing[actorId];
  if (!actorSt || actorSt.lifecycle === "deceased") {
    return { ok: false, reason: "协理者已故，权限失效。" };
  }
  if (isConfined(state, actorId)) {
    return { ok: false, reason: "协理者禁足中，无法行使位分处分权。" };
  }
  const actorRank = db.ranks[actorSt.rank];
  if (!actorRank) return { ok: false, reason: "协理者位分数据异常。" };
  const fuOrder = db.ranks["fu"]?.order ?? 176;
  if (actorRank.order < fuOrder) {
    return { ok: false, reason: "协理者位分不足驸级，处分权已失效。" };
  }

  const guirenOrder = db.ranks["guiren"]?.order ?? 100;

  // target 合法性。
  const targetSt = state.standing[targetId];
  if (!targetSt || targetSt.lifecycle === "deceased" || targetSt.lifecycle === "candidate") {
    return { ok: false, reason: "目标侍君状态不可处分。" };
  }
  if (targetSt.rank === "huanghou") {
    return { ok: false, reason: "不得处分皇后。" };
  }
  const targetRank = db.ranks[targetSt.rank];
  if (!targetRank) return { ok: false, reason: "目标位分数据异常。" };
  if (targetRank.order >= actorRank.order) {
    return { ok: false, reason: `不得处分与协理者（${actorRank.name}）同级或更高位的侍君。` };
  }
  if (targetRank.order >= guirenOrder) {
    return { ok: false, reason: "贵人及以上侍君不可由六宫主理者处分，须陛下亲旨。" };
  }

  // 目标新位分合法性。
  if (newRankId === "huanghou") {
    return { ok: false, reason: "不得册立皇后。" };
  }
  const newRank = db.ranks[newRankId];
  if (!newRank) return { ok: false, reason: "目标位分不存在。" };
  if (!isAssignableRank(newRank)) return { ok: false, reason: "该位分已废弃，不可新设。" };
  if (newRank.order >= actorRank.order) {
    return {
      ok: false,
      reason: `目标位分不能晋升到协理者（${actorRank.name}，order ${actorRank.order}）同级或以上。`,
    };
  }
  if (newRank.order > guirenOrder) {
    return { ok: false, reason: "六宫主理权不可晋至贵人以上，须陛下亲旨。" };
  }

  return { ok: true };
}

/**
 * 校验皇后能否对目标进行指定位分变更（empress 模式专用）。
 *
 * 必须同时满足：
 *  1. haremAdministration 为 empress 模式。
 *  2. actorId 必须是当前存活皇后的 charId。
 *  3. actor !== target。
 *  4. target 非皇后、非已故、非候选。
 *  5. target 当前 rank.order < guiren.order（贵人及以上须陛下亲旨）。
 *  6. newRankId 不为 huanghou。
 *  7. newRank 存在于 db.ranks，且 order <= guiren.order（最高只能晋至贵人）。
 */
export function canEmpressAdjustRank(
  db: ContentDB,
  state: GameState,
  actorId: string,
  targetId: string,
  newRankId: string,
): { ok: true } | { ok: false; reason: string } {
  const admin = state.haremAdministration;
  if (admin.mode !== "empress") {
    return { ok: false, reason: "当前六宫并非皇后主理，此权限无效。" };
  }

  // actorId 必须是当前存活皇后。
  const fenghouSt = state.standing[actorId];
  if (!fenghouSt || fenghouSt.rank !== "huanghou" || fenghouSt.lifecycle === "deceased") {
    return { ok: false, reason: "行为者不是当前皇后。" };
  }

  if (actorId === targetId) {
    return { ok: false, reason: "皇后不能调整自己的位分。" };
  }

  // target 合法性。
  const targetSt = state.standing[targetId];
  if (!targetSt || targetSt.lifecycle === "deceased" || targetSt.lifecycle === "candidate") {
    return { ok: false, reason: "目标侍君状态不可处分。" };
  }
  if (targetSt.rank === "huanghou") {
    return { ok: false, reason: "不得处分皇后。" };
  }
  // 贵人边界：贵人及以上须陛下亲旨，六宫主理权仅覆盖贵人以下（严格）。
  const guirenOrder = db.ranks["guiren"]?.order ?? 100;
  const targetRankData = db.ranks[targetSt.rank];
  if (!targetRankData || targetRankData.order >= guirenOrder) {
    return { ok: false, reason: "贵人及以上侍君不可由六宫主理者处分，须陛下亲旨。" };
  }

  // 目标新位分合法性。
  if (newRankId === "huanghou") {
    return { ok: false, reason: "不得册立皇后。" };
  }
  const newRank = db.ranks[newRankId];
  if (!newRank) return { ok: false, reason: "目标位分不存在。" };
  if (!isAssignableRank(newRank)) return { ok: false, reason: "该位分已废弃，不可新设。" };
  if (newRank.order > guirenOrder) {
    return { ok: false, reason: "六宫主理权不可晋至贵人以上，须陛下亲旨。" };
  }

  return { ok: true };
}
