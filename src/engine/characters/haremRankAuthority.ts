/**
 * 六宫行政位分处分权（§IV-IX）。
 *
 * 三态权限：
 *   empress mode        → harem_administrator/office:empress（凤后以自身名义处分驸级以上至凤后以下）
 *   acting_consort mode → harem_administrator（受限于自身位分，只能处分严格低于自己的侍君）
 *   neiwu_proxy mode    → none（内务府无位分处分权）
 *
 * 此模块不依赖 UI 层；可在 funnel.ts 验证中直接调用。
 */
import type { ContentDB } from "../content/loader";
import type { RankOperationAuthority } from "../content/schemas";
import type { GameState } from "../state/types";
import { isConfined } from "./confinement";

export type { RankOperationAuthority };

export type RankAuthority =
  | { kind: "sovereign"; actorId: "player"; maxTargetOrder: number }
  | { kind: "harem_administrator"; actorId: string; maxTargetOrder: number }
  | { kind: "none"; reason: string };

/**
 * 当前六宫行政位分处分权。
 *   empress mode        → harem_administrator（凤后以 charId 行使，maxTargetOrder = fenghou.order - 1）
 *   acting_consort mode → harem_administrator（只能处分严格低于自身位分 order 的侍君）
 *   neiwu_proxy mode    → none（无权）
 */
export function getHaremRankAuthority(db: ContentDB, state: GameState): RankAuthority {
  const admin = state.haremAdministration;

  if (admin.mode === "neiwu_proxy") {
    return { kind: "none", reason: "内务府仅暂代宫务，无权议定侍君位分。" };
  }

  if (admin.mode === "empress") {
    // 凤后以自身名义行使处分权：找当前凤后 charId。
    const fenghouId = Object.keys(state.standing).find(
      (id) => state.standing[id]!.rank === "fenghou" && state.standing[id]!.lifecycle !== "deceased",
    );
    if (!fenghouId) {
      return { kind: "none", reason: "当前宫中无凤后，无法行使处分权。" };
    }
    const fenghousOrder = db.ranks["fenghou"]?.order ?? 1000;
    return { kind: "harem_administrator", actorId: fenghouId, maxTargetOrder: fenghousOrder - 1 };
  }

  // acting_consort：只能处分 order 严格低于自身的侍君。
  const charId = admin.charId;
  const st = state.standing[charId];
  if (!st) return { kind: "none", reason: "协理者资料异常。" };
  const actorOrder = db.ranks[st.rank]?.order ?? 0;
  if (actorOrder <= 0) return { kind: "none", reason: "协理者位分数据异常。" };
  return { kind: "harem_administrator", actorId: charId, maxTargetOrder: actorOrder - 1 };
}

/**
 * 校验代理侍君能否对目标进行指定位分变更（含全部前置条件）。
 *
 * 必须同时满足：
 *  1. haremAdministration 为 acting_consort 且 actorId 匹配。
 *  2. 凤后仍在禁足（协理者有效的前提）。
 *  3. actor 存活、未禁足、仍达到驸级门槛。
 *  4. target 非 actor 本人。
 *  5. target 非凤后。
 *  6. target 当前 rank.order < actor rank.order（严格低于）。
 *  7. newRankId 的 order < actor rank.order（晋升后仍低于协理者）。
 *  8. newRankId 不为 fenghou。
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

  // 凤后必须仍在禁足。
  const fenghousId = Object.keys(state.standing).find(
    (id) => state.standing[id]!.rank === "fenghou" && state.standing[id]!.lifecycle !== "deceased",
  );
  if (!fenghousId) {
    return { ok: false, reason: "当前宫中无凤后，协理权限异常。" };
  }
  if (!isConfined(state, fenghousId)) {
    return { ok: false, reason: "凤后已恢复主理，协理者位分处分权失效。" };
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
  const fuOrder = db.ranks["fu"]?.order ?? 140;
  if (actorRank.order < fuOrder) {
    return { ok: false, reason: "协理者位分不足驸级，处分权已失效。" };
  }

  // target 合法性。
  const targetSt = state.standing[targetId];
  if (!targetSt || targetSt.lifecycle === "deceased" || targetSt.lifecycle === "candidate") {
    return { ok: false, reason: "目标侍君状态不可处分。" };
  }
  if (targetSt.rank === "fenghou") {
    return { ok: false, reason: "不得处分凤后。" };
  }
  const targetRank = db.ranks[targetSt.rank];
  if (!targetRank) return { ok: false, reason: "目标位分数据异常。" };
  if (targetRank.order >= actorRank.order) {
    return { ok: false, reason: `不得处分与协理者（${actorRank.name}）同级或更高位的侍君。` };
  }

  // 目标新位分合法性。
  if (newRankId === "fenghou") {
    return { ok: false, reason: "不得册立凤后。" };
  }
  const newRank = db.ranks[newRankId];
  if (!newRank) return { ok: false, reason: "目标位分不存在。" };
  if (newRank.order >= actorRank.order) {
    return {
      ok: false,
      reason: `目标位分不能晋升到协理者（${actorRank.name}，order ${actorRank.order}）同级或以上。`,
    };
  }

  return { ok: true };
}

/**
 * 校验凤后能否对目标进行指定位分变更（empress 模式专用）。
 *
 * 必须同时满足：
 *  1. haremAdministration 为 empress 模式。
 *  2. actorId 必须是当前存活凤后的 charId。
 *  3. actor !== target。
 *  4. target 非凤后、非已故、非候选。
 *  5. newRankId 不为 fenghou。
 *  6. newRank 存在于 db.ranks。
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
    return { ok: false, reason: "当前六宫并非凤后主理，此权限无效。" };
  }

  // actorId 必须是当前存活凤后。
  const fenghouSt = state.standing[actorId];
  if (!fenghouSt || fenghouSt.rank !== "fenghou" || fenghouSt.lifecycle === "deceased") {
    return { ok: false, reason: "行为者不是当前凤后。" };
  }

  if (actorId === targetId) {
    return { ok: false, reason: "凤后不能调整自己的位分。" };
  }

  // target 合法性。
  const targetSt = state.standing[targetId];
  if (!targetSt || targetSt.lifecycle === "deceased" || targetSt.lifecycle === "candidate") {
    return { ok: false, reason: "目标侍君状态不可处分。" };
  }
  if (targetSt.rank === "fenghou") {
    return { ok: false, reason: "不得处分凤后。" };
  }

  // 目标新位分合法性。
  if (newRankId === "fenghou") {
    return { ok: false, reason: "不得册立凤后。" };
  }
  const newRank = db.ranks[newRankId];
  if (!newRank) return { ok: false, reason: "目标位分不存在。" };

  return { ok: true };
}

