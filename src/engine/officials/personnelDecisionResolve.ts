/**
 * 人事决策的原子裁断（Phase 3 PR3C-3b）。一次裁断原子完成：
 *
 *   验证 decision pending → 验证裁断合法 → 调用正式职位 API（promoteOfficialAdministratively / punishOfficial）
 *   → 施加侍君关系/记忆后果（经 applyEffects 漏斗）→ 标记 decision resolved → 返回新 state。
 *
 * 任一步失败即返回 err，输入 state 不变（不改职位、不写历史、不写 PunishmentRecord、不推进 justice、不动关系、
 * 不标记 resolved）。**绝不**先 resolve 再执行职位变化。升迁=行政（不入 PUNISH）；降职/免官=皇帝亲发惩戒（入 PUNISH）。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { EventEffect } from "../content/schemas";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState, PersonnelDecision, PersonnelDecisionResolution } from "../state/types";
import { applyEffects } from "../effects/funnel";
import { punishOfficial, promoteOfficialAdministratively } from "./officialPunishment";
import { legalResolutionsFor } from "./personnelDecisions";

export interface ResolvePersonnelDecisionResult {
  state: GameState;
  /** 降职/免官裁断产生的官员 PunishmentRecord id（行政升迁/拒绝/罪止其身无）。 */
  punishmentId?: string;
}

/** 侍君请求被同意：适度正面关系 + 私下感念记忆。 */
function petitionApprovedEffects(consortId: string, hasMemory: boolean): EventEffect[] {
  const fx: EventEffect[] = [
    { type: "favor", char: consortId, delta: 5 },
    { type: "adjust_consort_attr", char: consortId, field: "affection", delta: 6 },
    { type: "adjust_consort_attr", char: consortId, field: "loyalty", delta: 4 },
  ];
  if (hasMemory) {
    fx.push({
      type: "memory", char: consortId,
      entry: {
        kind: "gratitude", summary: "我私下求陛下擢拔族中之人，陛下允了。",
        subjectIds: ["player"], perspective: "actor", strength: 55, retention: "slow",
        triggerTags: ["personnel", "promotion"], unresolved: false, emotions: { joy: 30 },
      },
    });
  }
  return fx;
}

/** 侍君请求被拒：适度负面关系 + 私下被拒记忆（不广播全宫）。 */
function petitionRejectedEffects(consortId: string, hasMemory: boolean): EventEffect[] {
  const fx: EventEffect[] = [
    { type: "favor", char: consortId, delta: -6 },
    { type: "adjust_consort_attr", char: consortId, field: "affection", delta: -8 },
    { type: "adjust_consort_attr", char: consortId, field: "loyalty", delta: -4 },
  ];
  if (hasMemory) {
    fx.push({
      type: "memory", char: consortId,
      entry: {
        kind: "grievance", summary: "我私下求陛下擢拔族中之人，陛下回绝了。",
        subjectIds: ["player"], perspective: "actor", strength: 50, retention: "slow",
        triggerTags: ["personnel", "promotion"], unresolved: true, emotions: { shame: 25, grief: 20 },
      },
    });
  }
  return fx;
}

/** 牵连家族·罪止其身：侍君感念记忆（未牵连）。 */
function implicationSparedEffects(consortId: string, hasMemory: boolean): EventEffect[] {
  if (!hasMemory) return [];
  return [{
    type: "memory", char: consortId,
    entry: {
      kind: "gratitude", summary: "我虽获罪，陛下止罪于我一身，未牵连家族官属。",
      subjectIds: ["player"], perspective: "target", strength: 55, retention: "slow",
      triggerTags: ["personnel", "punishment"], unresolved: false, emotions: { relief: 30 },
    },
  }];
}

/** 牵连家族·降/免：侍君创伤记忆（连同新官员 punishment 溯源）。 */
function implicationPunishedEffects(consortId: string, dismissed: boolean, punishmentId: string, hasMemory: boolean): EventEffect[] {
  if (!hasMemory) return [];
  return [{
    type: "memory", char: consortId,
    entry: {
      kind: "trauma",
      summary: dismissed ? "我获罪，陛下因此免去我族中官员之职。" : "我获罪，陛下因此贬降我族中官员之职。",
      subjectIds: ["player"], perspective: "target", strength: dismissed ? 70 : 60, retention: "permanent",
      triggerTags: ["personnel", "punishment"], unresolved: true, emotions: { grief: 35, fear: 25 },
      sourcePunishmentId: punishmentId,
    },
  }];
}

/**
 * 原子裁断一条人事决策。失败返回 err（state 不变）；成功返回新 state 与可选 punishmentId。
 */
export function resolvePersonnelDecision(
  state: GameState,
  db: ContentDB,
  decisionId: string,
  resolution: PersonnelDecisionResolution,
  at: GameTime,
): Result<ResolvePersonnelDecisionResult, GameError> {
  const d = state.personnelDecisions[decisionId];
  if (!d) return err(stateError("DECISION_NOT_FOUND", `无此人事决策「${decisionId}」`, { context: { decisionId } }));
  if (d.status !== "pending") return err(stateError("DECISION_ALREADY_RESOLVED", `人事决策「${decisionId}」已裁断`, { context: { decisionId, status: d.status } }));
  if (!legalResolutionsFor(d.kind).includes(resolution)) {
    return err(stateError("DECISION_BAD_RESOLUTION", `裁断「${resolution}」对「${d.kind}」非法`, { context: { decisionId, kind: d.kind, resolution } }));
  }

  const consortId = d.consortId;
  const hasMemory = consortId !== undefined && state.memories[consortId] !== undefined;

  let cur = state;
  let punishmentId: string | undefined;
  let effects: EventEffect[] = [];

  // 1) 职位变更（经正式 API；先于关系后果，任一失败整体中止）。
  switch (d.kind) {
    case "consort_petition_promotion":
    case "memorial_promotion": {
      if (resolution === "approve") {
        if (!d.recommendedPostId) return err(stateError("DECISION_BAD_TARGET", "升迁裁断缺目标官职", { context: { decisionId } }));
        const r = promoteOfficialAdministratively(cur, db, d.officialId, d.recommendedPostId, at);
        if (!r.ok) return err(r.error);
        cur = r.value;
      }
      if (d.kind === "consort_petition_promotion" && consortId) {
        effects = resolution === "approve"
          ? petitionApprovedEffects(consortId, hasMemory)
          : petitionRejectedEffects(consortId, hasMemory);
      }
      break;
    }
    case "memorial_demotion": {
      if (resolution === "approve") {
        if (!d.recommendedPostId) return err(stateError("DECISION_BAD_TARGET", "降职裁断缺目标官职", { context: { decisionId } }));
        const r = punishOfficial(cur, db, { officialId: d.officialId, kind: "official_demotion", toPostId: d.recommendedPostId, publicity: "palace" }, at);
        if (!r.ok) return err(r.error);
        cur = r.value.state;
        punishmentId = r.value.punishmentId;
      }
      break;
    }
    case "memorial_dismissal": {
      if (resolution === "approve") {
        const r = punishOfficial(cur, db, { officialId: d.officialId, kind: "official_dismissal", publicity: "public" }, at);
        if (!r.ok) return err(r.error);
        cur = r.value.state;
        punishmentId = r.value.punishmentId;
      }
      break;
    }
    case "family_implication": {
      // 注意：**不**把来源侍君案件 caseId 传给官员 punishment——侍君案件 subjectIds 不含其族官员，
      // justice 会拒绝（subject 不匹配）。官员惩戒为独立记录，叙事溯源由 decision.sourcePunishmentId 保留。
      if (resolution === "demote") {
        if (!d.recommendedPostId) return err(stateError("DECISION_BAD_TARGET", "牵连降职裁断缺目标官职", { context: { decisionId } }));
        const r = punishOfficial(cur, db, { officialId: d.officialId, kind: "official_demotion", toPostId: d.recommendedPostId, publicity: "palace" }, at);
        if (!r.ok) return err(r.error);
        cur = r.value.state;
        punishmentId = r.value.punishmentId;
      } else if (resolution === "dismiss") {
        const r = punishOfficial(cur, db, { officialId: d.officialId, kind: "official_dismissal", publicity: "palace" }, at);
        if (!r.ok) return err(r.error);
        cur = r.value.state;
        punishmentId = r.value.punishmentId;
      }
      if (consortId) {
        effects = resolution === "spare"
          ? implicationSparedEffects(consortId, hasMemory)
          : implicationPunishedEffects(consortId, resolution === "dismiss", punishmentId!, hasMemory);
      }
      break;
    }
  }

  // 2) 侍君关系/记忆后果（经漏斗；失败整体中止）。
  if (effects.length > 0) {
    const applied = applyEffects(db, cur, effects, { sceneId: "personnel_decision" });
    if (!applied.ok) return err(applied.error[0]!);
    cur = applied.value;
  }

  // 3) 标记 resolved（最后一步；前序任一失败则此处不执行）。
  const resolved: PersonnelDecision = { ...d, status: "resolved", resolvedAt: at, resolution };
  cur = { ...cur, personnelDecisions: { ...cur.personnelDecisions, [d.id]: resolved } };

  return ok({ state: cur, ...(punishmentId ? { punishmentId } : {}) });
}
