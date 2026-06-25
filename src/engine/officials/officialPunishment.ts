/**
 * 官员惩戒与行政升迁（Phase 3 PR3C-3a）。
 *
 * **皇帝亲发的惩戒性降职/免官**经此处——进入既有（已 domain-neutral 化的）PUNISH 记录体系：分配
 * punishmentId、写 PunishmentRecord（targetKind=official，即时 completed）、写 officialHistory（带
 * punishmentId）、追加「punished」CourtEvent，并施加**独立的官员后果**（官员忠心↓、家族皇恩↓）——
 * **绝不**经侍君属性后果（adjust_consort_attr）。事后自动补缺（排除被罚者）。原子：失败 state 完全不变。
 *
 * **行政升迁/调任不算惩罚**：`promoteOfficialAdministratively` 绝不创建 PunishmentRecord，只记常规
 * officialHistory + 行政奖励后果（忠心↑、家族皇恩↑）。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState, Official, OfficialFamily, OfficialHistoryEntry } from "../state/types";
import { officialPunishmentSeverity, type OfficialPunishmentKind } from "../punishments/types";
import type { PunishmentRecord } from "../justice/types";
import { allocateJusticeIds } from "../justice/ids";
import { applyJusticePlan } from "../justice/mutations";
import { appendCourtEvent } from "../chronicle/append";
import { officialHistoryId } from "./lifecycle";
import { isPostVacant } from "./selectors";
import { resolveOfficialVacancies } from "./annualReview";

export interface OfficialPunishmentCommand {
  officialId: string;
  kind: OfficialPunishmentKind;
  /** 降职目标官职（official_demotion 必填；免官忽略）。 */
  toPostId?: string;
  publicity?: "secret" | "palace" | "public";
  sourceLocation?: string;
  caseId?: string;
}

/** 惩戒后果幅度（独立于侍君系统）。 */
const PUNISH_LOYALTY_DROP: Record<OfficialPunishmentKind, number> = { official_demotion: 15, official_dismissal: 28 };
const PUNISH_FAMILY_FAVOR_DROP: Record<OfficialPunishmentKind, number> = { official_demotion: 8, official_dismissal: 14 };
/** 行政升迁奖励幅度。 */
const PROMOTE_LOYALTY_GAIN = 8;
const PROMOTE_FAMILY_FAVOR_GAIN = 6;

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const gradeOf = (db: ContentDB, postId: string | null): number => (postId ? (db.officialPosts[postId]?.gradeOrder ?? 0) : 0);

/** 施加家族皇恩增量（家族存在才动）。 */
function adjustFamilyFavor(state: GameState, familyId: string, delta: number): GameState {
  const fam = state.officialFamilies[familyId];
  if (!fam) return state;
  const next: OfficialFamily = { ...fam, imperialFavor: clamp100(fam.imperialFavor + delta) };
  return { ...state, officialFamilies: { ...state.officialFamilies, [familyId]: next } };
}

/** 受控移动 + 忠心增量 + officialHistory（可带 punishmentId / reason）。 */
function moveWithHistory(
  state: GameState,
  officialId: string,
  toPostId: string | null,
  loyaltyDelta: number,
  at: GameTime,
  extra: { punishmentId?: string; reason?: "dismissal" },
): GameState {
  const cur = state.officials[officialId]!;
  const next: Official = {
    ...cur,
    postId: toPostId,
    loyalty: clamp100(cur.loyalty + loyaltyDelta),
    ...(toPostId !== null ? { appointedAt: at } : {}),
  };
  const entry: OfficialHistoryEntry = {
    id: officialHistoryId(state.officialHistory.length + 1),
    officialId,
    status: "active",
    at,
    ...(cur.postId !== null ? { vacatedPostId: cur.postId } : {}),
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.punishmentId ? { punishmentId: extra.punishmentId } : {}),
  };
  return { ...state, officials: { ...state.officials, [officialId]: next }, officialHistory: [...state.officialHistory, entry] };
}

/**
 * 皇帝亲发的官员惩戒（降职/免官）。原子：PunishmentRecord + officialHistory(punishmentId) + CourtEvent +
 * 独立后果（忠心↓/家族皇恩↓）+ 自动补缺（排除被罚者）。失败返回 err，state 不变。
 */
export function punishOfficial(state: GameState, db: ContentDB, command: OfficialPunishmentCommand, at: GameTime): Result<{ state: GameState; punishmentId: string }, GameError> {
  const o = state.officials[command.officialId];
  if (!o) return err(stateError("OFFICIAL_NOT_FOUND", `无此官员「${command.officialId}」`, { context: { officialId: command.officialId } }));
  if (o.status !== "active" || o.postId === null) {
    return err(stateError("OFFICIAL_NOT_PUNISHABLE", `官员「${command.officialId}」非在任占职，无可惩戒处置`, { context: { officialId: command.officialId, status: o.status } }));
  }
  const fromPostId = o.postId;
  const fromGrade = gradeOf(db, fromPostId);

  let toPostId: string | null;
  if (command.kind === "official_demotion") {
    if (!command.toPostId) return err(stateError("OFFICIAL_BAD_POST", "降职须指定目标官职", { context: { officialId: command.officialId } }));
    const post = db.officialPosts[command.toPostId];
    if (!post || post.gradeOrder <= 0 || post.gradeOrder >= fromGrade) {
      return err(stateError("OFFICIAL_BAD_POST", `降职目标「${command.toPostId}」须为更低品级有效官职`, { context: { officialId: command.officialId, toPostId: command.toPostId } }));
    }
    if (!isPostVacant(state, db, command.toPostId)) {
      return err(stateError("OFFICIAL_SEAT_FULL", `降职目标「${command.toPostId}」无空席`, { context: { officialId: command.officialId, toPostId: command.toPostId } }));
    }
    toPostId = command.toPostId;
  } else {
    toPostId = null; // 免官：去职为无职（仍 active）
  }

  // 1) 分配 punishmentId + 写 PunishmentRecord（即时 completed）。
  const alloc = allocateJusticeIds(state.justice, { punishments: 1 });
  const punishmentId = alloc.punishments[0]!;
  const record: PunishmentRecord =
    command.kind === "official_demotion"
      ? {
          id: punishmentId, targetId: command.officialId, targetKind: "official", actorId: "player", kind: "official_demotion",
          severity: officialPunishmentSeverity("official_demotion"), imposedAt: at, publicity: command.publicity ?? "palace",
          lifecycle: { status: "completed", resolvedAt: at, resolution: "immediate" },
          ...(command.caseId ? { caseId: command.caseId } : {}), ...(command.sourceLocation ? { sourceLocation: command.sourceLocation } : {}),
          details: { fromPostId, toPostId },
        }
      : {
          id: punishmentId, targetId: command.officialId, targetKind: "official", actorId: "player", kind: "official_dismissal",
          severity: officialPunishmentSeverity("official_dismissal"), imposedAt: at, publicity: command.publicity ?? "palace",
          lifecycle: { status: "completed", resolvedAt: at, resolution: "immediate" },
          ...(command.caseId ? { caseId: command.caseId } : {}), ...(command.sourceLocation ? { sourceLocation: command.sourceLocation } : {}),
          details: { fromPostId },
        };
  const justiced = applyJusticePlan(state, { mutations: [{ type: "create_punishment", record }], nextSeq: alloc.nextSeq });
  if (!justiced.ok) return err(justiced.error[0]!);
  let cur = justiced.value;

  // 2) 独立后果：官员忠心↓ + 家族皇恩↓；移动 + officialHistory(带 punishmentId)。
  cur = moveWithHistory(cur, command.officialId, toPostId, -PUNISH_LOYALTY_DROP[command.kind], at, {
    punishmentId,
    ...(command.kind === "official_dismissal" ? { reason: "dismissal" as const } : {}),
  });
  cur = adjustFamilyFavor(cur, o.familyId, -PUNISH_FAMILY_FAVOR_DROP[command.kind]);

  // 3) 「punished」CourtEvent（携 punishmentId 溯源）。
  const evt = appendCourtEvent(cur, {
    type: "punished",
    occurredAt: at,
    participants: [{ charId: command.officialId, role: command.kind === "official_demotion" ? "demoted" : "dismissed" }],
    ...(command.sourceLocation ? { locationId: command.sourceLocation } : {}),
    payload: { punishmentId, kind: command.kind, fromPostId, toPostId },
    publicity: { scope: "palace", persistence: "institutional" },
    publicSalience: command.kind === "official_dismissal" ? 55 : 40,
    retention: "slow",
    tags: ["official_punishment"],
  });
  if (!evt.ok) return err(evt.error[0]!);
  cur = evt.value.state;

  // 4) 自动补缺（排除被罚者，不得同事务被升回原职）。
  cur = resolveOfficialVacancies(cur, db, at, new Set([command.officialId])).state;

  return ok({ state: cur, punishmentId });
}

/**
 * 行政升迁（玩家批准）：把在任官员提到更高有空席官职。**不算惩罚**——绝不创建 PunishmentRecord/
 * punishmentId，只记常规 officialHistory + 行政奖励（忠心↑/家族皇恩↑），并自动补缺其旧职。
 */
export function promoteOfficialAdministratively(state: GameState, db: ContentDB, officialId: string, toPostId: string, at: GameTime): Result<GameState, GameError> {
  const o = state.officials[officialId];
  if (!o) return err(stateError("OFFICIAL_NOT_FOUND", `无此官员「${officialId}」`, { context: { officialId } }));
  if (o.status !== "active" || o.postId === null) return err(stateError("OFFICIAL_NOT_ACTIVE", `官员「${officialId}」非在任占职，不可升迁`, { context: { officialId } }));
  const post = db.officialPosts[toPostId];
  if (!post || post.gradeOrder <= 0 || post.gradeOrder <= gradeOf(db, o.postId)) {
    return err(stateError("OFFICIAL_BAD_POST", `升迁目标「${toPostId}」须为更高品级有效官职`, { context: { officialId, toPostId } }));
  }
  if (!isPostVacant(state, db, toPostId)) return err(stateError("OFFICIAL_SEAT_FULL", `升迁目标「${toPostId}」无空席`, { context: { officialId, toPostId } }));

  let cur = moveWithHistory(state, officialId, toPostId, PROMOTE_LOYALTY_GAIN, at, {}); // 无 punishmentId
  cur = adjustFamilyFavor(cur, o.familyId, PROMOTE_FAMILY_FAVOR_GAIN);
  cur = resolveOfficialVacancies(cur, db, at, new Set([officialId])).state;
  return ok(cur);
}
