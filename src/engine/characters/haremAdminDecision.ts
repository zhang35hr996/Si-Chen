/**
 * 六宫自主位分决策引擎（§IV-X 第二阶段）。
 *
 * 皇后或协理六宫者根据候选条件与性格修正，从合格低位侍君中选出一名进行
 * 晋位或降位。玩家不参与目标或结果的选择。
 *
 * 纯函数——不修改 state，不产生副作用。
 * 确定性：同一 state 必然产生同一结果；tie-break 使用年月种子的 FNV-1a hash。
 */
import type { ContentDB } from "../content/loader";
import type { ConsortPersonality, GameState } from "../state/types";
import { isConfined } from "./confinement";
import { isInColdPalace } from "./coldPalace";
import { resolveConsortRuntimeAttrs } from "./consortAttrs";
import { canEmpressAdjustRank, canAdministratorAdjustRank } from "./haremRankAuthority";
import {
  nextAdministrativeRank,
  previousAdministrativeRank,
} from "./haremRankLadder";

// ── 结果类型 ──────────────────────────────────────────────────────────────────

export type HaremAdminDecisionReason =
  | "service_merit"      // 恩宠佳、宫务勤谨 → 晋位
  | "household_order"    // 宫室秩序优良 → 晋位
  | "disloyalty"         // 忠诚低 → 降位
  | "household_disorder"; // 宫室秩序低劣 → 降位

export interface HaremAdminDecision {
  actorId: string;
  office: "empress" | "acting_consort";
  targetId: string;
  direction: "promote" | "demote";
  fromRankId: string;
  toRankId: string;
  reason: HaremAdminDecisionReason;
  /**
   * 规范化评分（promote 正，demote 负）。绝对值等于内部 priority，便于 #73B 显示"力度"。
   * 内部排序用 priority（非负），此字段仅供外部消费。
   */
  score: number;
}

// Re-export for backward compatibility (some callers import from this module).
export { nextAdministrativeRank, previousAdministrativeRank } from "./haremRankLadder";

// ── 冷却检查 ──────────────────────────────────────────────────────────────────

const COOLDOWN_MONTHS = 12;

function wasRecentlyAdjustedByAdmin(
  state: GameState,
  targetId: string,
): boolean {
  const { year: curYear, month: curMonth } = state.calendar;
  for (const event of state.chronicle) {
    if (event.type !== "rank_changed") continue;
    if (!(event.tags as string[]).includes("harem_administration")) continue;
    if (!event.participants.some(
      (p) => p.charId === targetId && (p.role === "recipient" || p.role === "demoted"),
    )) continue;
    const { year, month } = event.occurredAt;
    const monthsAgo = (curYear - year) * 12 + (curMonth - month);
    if (monthsAgo >= 0 && monthsAgo < COOLDOWN_MONTHS) return true;
  }
  return false;
}

// ── 确定性 tie-break (FNV-1a 32-bit) ─────────────────────────────────────────

function tieBreakHash(year: number, month: number, actorId: string, charId: string, direction: string): number {
  const seed = `${year}:${month}:${actorId}:${charId}:${direction}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// ── 性格修正（priority 语义：正数增加，负数减小；限幅 ±10）────────────────────

function personalityAdjustment(
  p: ConsortPersonality,
  actorFavor: number,
  targetFavor: number,
  targetLoyalty: number,
  targetAmbition: number,
  targetServantOpinion: number,
  direction: "promote" | "demote",
): number {
  let adj = 0;

  if (direction === "demote") {
    // 仁慈高 → 降低降位优先度（不轻易处罚）。
    adj -= (p.compassion - 50) * 0.15;
    // 骄傲高 + 宫人评价低 → 增加降位优先度（无法容忍宫务失序）。
    adj += (p.pride - 50) * 0.08 * (50 - targetServantOpinion) / 50;
  } else {
    // 嫉妒高 + 目标恩宠明显高于自己 → 降低晋位优先度。
    if (targetFavor > actorFavor + 15) {
      adj -= (p.jealousy - 50) * 0.1;
    }
    // 心机高 → 偏好忠诚高、野心低者晋位。
    adj += (p.scheming / 100) * ((targetLoyalty - 50) * 0.08 - (targetAmbition - 50) * 0.06);
    // 骄傲高 + 宫人评价高 → 增加晋位优先度（奖励宫务优良者）。
    adj += (p.pride - 50) * 0.08 * (targetServantOpinion - 50) / 50;
  }

  return Math.max(-10, Math.min(10, adj));
}

// ── 候选原因（在生成时确定，不从综合分倒推）──────────────────────────────────

function resolvePromoteReason(targetFavor: number, targetLoyalty: number): HaremAdminDecisionReason {
  return targetFavor >= 55 && targetLoyalty >= 60 ? "service_merit" : "household_order";
}

function resolveDemoteReason(loyalty: number, servantOpinion: number): HaremAdminDecisionReason {
  if (loyalty <= 25 && servantOpinion <= 25) {
    return loyalty <= servantOpinion ? "disloyalty" : "household_disorder";
  }
  return loyalty <= 25 ? "disloyalty" : "household_disorder";
}

// ── 候选筛选 ─────────────────────────────────────────────────────────────────

interface ScoredCandidate {
  charId: string;
  direction: "promote" | "demote";
  fromRankId: string;
  toRankId: string;
  reason: HaremAdminDecisionReason;
  /** 非负权重；越大越优先。 */
  priority: number;
  tieBreak: number;
}

function collectCandidates(
  db: ContentDB,
  state: GameState,
  actorId: string,
  office: "empress" | "acting_consort",
  guirenOrder: number,
  year: number,
  month: number,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const actorSt = state.standing[actorId];
  const actorFavor = actorSt?.favor ?? 50;
  const actorPersonality = resolveConsortRuntimeAttrs(db, state, actorId).personality;

  for (const [charId, st] of Object.entries(state.standing)) {
    if (!st) continue;
    if (st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
    if (charId === actorId) continue;
    if (st.rank === "huanghou") continue;

    const rankData = db.ranks[st.rank];
    if (!rankData || rankData.order >= guirenOrder) continue;

    if (isConfined(state, charId)) continue;
    if (isInColdPalace(state, charId)) continue;
    if (wasRecentlyAdjustedByAdmin(state, charId)) continue;

    const targetFavor = st.favor;
    const attrs = resolveConsortRuntimeAttrs(db, state, charId);
    const { loyalty } = attrs;
    const { servantOpinion } = attrs.household;
    const { ambition } = attrs;

    // 晋位候选
    const promoteToId = nextAdministrativeRank(db, st.rank);
    if (promoteToId) {
      const promoteRankOrder = db.ranks[promoteToId]?.order ?? 9999;
      if (promoteRankOrder <= guirenOrder) {
        const check = office === "empress"
          ? canEmpressAdjustRank(db, state, actorId, charId, promoteToId)
          : canAdministratorAdjustRank(db, state, actorId, charId, promoteToId);
        if (check.ok && targetFavor >= 45 && loyalty >= 50 && servantOpinion >= 50) {
          const base = (targetFavor - 45) * 0.4 + (loyalty - 50) * 0.3 + (servantOpinion - 50) * 0.3;
          const adj = personalityAdjustment(actorPersonality, actorFavor, targetFavor, loyalty, ambition, servantOpinion, "promote");
          out.push({
            charId,
            direction: "promote",
            fromRankId: st.rank,
            toRankId: promoteToId,
            reason: resolvePromoteReason(targetFavor, loyalty),
            priority: Math.max(0, base + adj),
            tieBreak: tieBreakHash(year, month, actorId, charId, "promote"),
          });
        }
      }
    }

    // 降位候选
    const demoteToId = previousAdministrativeRank(db, st.rank);
    if (demoteToId) {
      const check = office === "empress"
        ? canEmpressAdjustRank(db, state, actorId, charId, demoteToId)
        : canAdministratorAdjustRank(db, state, actorId, charId, demoteToId);
      if (check.ok && (loyalty <= 25 || servantOpinion <= 25)) {
        const base = (50 - Math.min(loyalty, servantOpinion)) * 0.6;
        const adj = personalityAdjustment(actorPersonality, actorFavor, targetFavor, loyalty, ambition, servantOpinion, "demote");
        out.push({
          charId,
          direction: "demote",
          fromRankId: st.rank,
          toRankId: demoteToId,
          reason: resolveDemoteReason(loyalty, servantOpinion),
          priority: Math.max(0, base + adj),
          tieBreak: tieBreakHash(year, month, actorId, charId, "demote"),
        });
      }
    }
  }

  return out;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 由皇后或协理六宫者对合格低位侍君做出一次自主位分决策。
 *
 * @param administratorId 行政者 charId（须与当前 haremAdministration 状态一致）。
 * @returns 决策对象，或 null（无合格目标 / 无权限 / neiwu_proxy 模式）。
 */
export function planAdministratorRankDecision(
  db: ContentDB,
  state: GameState,
  administratorId: string,
): HaremAdminDecision | null {
  const admin = state.haremAdministration;
  if (admin.mode === "neiwu_proxy") return null;

  let actorId: string;
  let office: "empress" | "acting_consort";

  if (admin.mode === "empress") {
    const empressId = Object.keys(state.standing).find(
      (id) => state.standing[id]!.rank === "huanghou" && state.standing[id]!.lifecycle !== "deceased",
    );
    if (!empressId || empressId !== administratorId) return null;
    actorId = empressId;
    office = "empress";
  } else {
    if (admin.charId !== administratorId) return null;
    actorId = admin.charId;
    office = "acting_consort";
  }

  const guirenOrder = db.ranks["guiren"]?.order ?? 116;
  const { year, month } = state.calendar;

  const candidates = collectCandidates(db, state, actorId, office, guirenOrder, year, month);
  if (candidates.length === 0) return null;

  // priority 降序；同分时 tieBreak 升序（确定性）。
  candidates.sort((a, b) => b.priority - a.priority || a.tieBreak - b.tieBreak);

  const top = candidates[0]!;
  return {
    actorId,
    office,
    targetId: top.charId,
    direction: top.direction,
    fromRankId: top.fromRankId,
    toRankId: top.toRankId,
    reason: top.reason,
    score: top.direction === "promote" ? top.priority : -top.priority,
  };
}
