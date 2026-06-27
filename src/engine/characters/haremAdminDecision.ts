/**
 * 六宫自主位分决策引擎（§IV-X 第二阶段）。
 *
 * 皇后或协理六宫者根据候选条件与性格修正，从合格低位侍君中选出一名进行
 * 晋位或降位。玩家不参与目标或结果的选择。
 *
 * 纯函数——不修改 state，不产生副作用。
 */
import type { ContentDB } from "../content/loader";
import { isAssignableRank } from "../content/schemas";
import type { GameState } from "../state/types";
import { resolveConsortRuntimeAttrs } from "./consortAttrs";
import { canEmpressAdjustRank, canAdministratorAdjustRank } from "./haremRankAuthority";

// ── 结果类型 ──────────────────────────────────────────────────────────────────

export type HaremAdminDecisionReason =
  | "service_merit"      // 恩宠佳、宫务勤谨 → 晋位
  | "household_order"    // 宫室秩序优良 → 晋位
  | "disloyalty"         // 忠诚低、宫务失职 → 降位
  | "household_disorder"; // 宫室秩序低劣 → 降位

export interface HaremAdminDecision {
  actorId: string;
  office: "empress" | "acting_consort";
  targetId: string;
  direction: "promote" | "demote";
  fromRankId: string;
  toRankId: string;
  reason: HaremAdminDecisionReason;
  /** 规范化评分（promote 正，demote 负；绝对值越大权重越高）。 */
  score: number;
}

// ── rank ladder helpers ───────────────────────────────────────────────────────

/** 后宫可授位分的升序列表（order 小 → 大）。 */
function sortedHaremRanks(db: ContentDB) {
  return Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && isAssignableRank(r))
    .sort((a, b) => a.order - b.order);
}

/** 晋一级（上一个可授位分）。不存在时返回 null。 */
export function nextAdministrativeRank(db: ContentDB, currentRankId: string): string | null {
  const ladder = sortedHaremRanks(db);
  const idx = ladder.findIndex((r) => r.id === currentRankId);
  if (idx < 0 || idx + 1 >= ladder.length) return null;
  return ladder[idx + 1]!.id;
}

/** 降一级（下一个可授位分）。不存在时返回 null。 */
export function previousAdministrativeRank(db: ContentDB, currentRankId: string): string | null {
  const ladder = sortedHaremRanks(db);
  const idx = ladder.findIndex((r) => r.id === currentRankId);
  if (idx <= 0) return null;
  return ladder[idx - 1]!.id;
}

// ── 冷却检查 ──────────────────────────────────────────────────────────────────

const COOLDOWN_MONTHS = 12;

/** 过去 COOLDOWN_MONTHS 个月内是否已由六宫主理者调整过位分。 */
function wasRecentlyAdjustedByAdmin(
  state: GameState,
  targetId: string,
  currentYear: number,
  currentMonth: number,
): boolean {
  for (const event of state.chronicle) {
    if (event.type !== "rank_changed") continue;
    if (!(event.tags as string[]).includes("harem_administration")) continue;
    if (!event.participants.some((p) => p.charId === targetId)) continue;
    const { year, month } = event.occurredAt;
    const monthsAgo = (currentYear - year) * 12 + (currentMonth - month);
    if (monthsAgo >= 0 && monthsAgo < COOLDOWN_MONTHS) return true;
  }
  return false;
}

// ── 确定性 tie-break ─────────────────────────────────────────────────────────

/** 简单 FNV-like hash，用于同分打平排序（不用于资格判定）。 */
function tieBreakHash(year: number, actorId: string, charId: string, direction: string): number {
  const seed = `${year}:${actorId}:${charId}:${direction}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// ── 候选筛选 ─────────────────────────────────────────────────────────────────

interface ScoredCandidate {
  charId: string;
  direction: "promote" | "demote";
  fromRankId: string;
  toRankId: string;
  score: number;
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
  actorPersonality: ReturnType<typeof resolveConsortRuntimeAttrs>["personality"],
  actorFavor: number,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];

  for (const [charId, st] of Object.entries(state.standing)) {
    if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
    if (charId === actorId) continue;
    if (st.rank === "huanghou") continue;

    const rankData = db.ranks[st.rank];
    if (!rankData || rankData.order >= guirenOrder) continue;

    if (wasRecentlyAdjustedByAdmin(state, charId, year, month)) continue;

    const attrs = resolveConsortRuntimeAttrs(db, state, charId);

    // 晋位候选
    const promoteToId = nextAdministrativeRank(db, st.rank);
    if (promoteToId) {
      const promoteRank = db.ranks[promoteToId]!;
      if (promoteRank.order <= guirenOrder) {
        const promoteCheck = office === "empress"
          ? canEmpressAdjustRank(db, state, actorId, charId, promoteToId)
          : canAdministratorAdjustRank(db, state, actorId, charId, promoteToId);
        if (promoteCheck.ok && attrs.affection >= 45 && attrs.loyalty >= 50 && attrs.household.servantOpinion >= 50) {
          const base = (attrs.affection - 45) * 0.4 + (attrs.loyalty - 50) * 0.3 + (attrs.household.servantOpinion - 50) * 0.3;
          const adj = personalityAdjustment(actorPersonality, actorFavor, attrs, "promote");
          out.push({
            charId,
            direction: "promote",
            fromRankId: st.rank,
            toRankId: promoteToId,
            score: base + adj,
            tieBreak: tieBreakHash(year, actorId, charId, "promote"),
          });
        }
      }
    }

    // 降位候选
    const demoteToId = previousAdministrativeRank(db, st.rank);
    if (demoteToId) {
      const demoteCheck = office === "empress"
        ? canEmpressAdjustRank(db, state, actorId, charId, demoteToId)
        : canAdministratorAdjustRank(db, state, actorId, charId, demoteToId);
      if (demoteCheck.ok && (attrs.loyalty <= 25 || attrs.household.servantOpinion <= 25)) {
        const base = -(50 - Math.min(attrs.loyalty, attrs.household.servantOpinion)) * 0.6;
        const adj = personalityAdjustment(actorPersonality, actorFavor, attrs, "demote");
        out.push({
          charId,
          direction: "demote",
          fromRankId: st.rank,
          toRankId: demoteToId,
          score: base + adj,
          tieBreak: tieBreakHash(year, actorId, charId, "demote"),
        });
      }
    }
  }

  return out;
}

// ── 性格修正（限幅 ±10）────────────────────────────────────────────────────────

function personalityAdjustment(
  actorPersonality: ReturnType<typeof resolveConsortRuntimeAttrs>["personality"],
  actorFavor: number,
  targetAttrs: ReturnType<typeof resolveConsortRuntimeAttrs>,
  direction: "promote" | "demote",
): number {
  const p = actorPersonality;
  let adj = 0;

  // 仁慈高 → 提高降位门槛（负修正）。
  if (direction === "demote") {
    adj -= (p.compassion - 50) * 0.15;
  }

  // 嫉妒高 → 对恩宠明显高于自己的目标负修正（阻止晋位，加速降位）。
  if (targetAttrs.affection > actorFavor + 15) {
    adj -= (p.jealousy - 50) * 0.1;
  }

  // 心机高 → 偏好忠诚高、野心低者。
  adj += (p.scheming / 100) * ((targetAttrs.loyalty - 50) * 0.08 - (targetAttrs.ambition - 50) * 0.06);

  // 骄傲高 → 更重视宫室秩序。
  adj += (p.pride - 50) * 0.08 * (targetAttrs.household.servantOpinion - 50) / 50;

  return Math.max(-10, Math.min(10, adj));
}

// ── 原因推断 ─────────────────────────────────────────────────────────────────

function resolveReason(c: ScoredCandidate): HaremAdminDecisionReason {
  if (c.direction === "promote") {
    return c.score > 3 ? "service_merit" : "household_order";
  }
  return c.score < -4 ? "disloyalty" : "household_disorder";
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 由皇后或协理六宫者对合格低位侍君做出一次自主位分决策。
 *
 * @param administratorId 行政者 charId（须与当前 haremAdministration 状态一致）。
 * @param year 当前年份（用于 cooldown 和 tie-break 确定性种子）。
 * @returns 决策对象，或 null（无合格目标 / 无权限 / neiwu_proxy 模式）。
 */
export function planAdministratorRankDecision(
  db: ContentDB,
  state: GameState,
  administratorId: string,
  year: number,
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
  const { month } = state.calendar;
  const actorAttrs = resolveConsortRuntimeAttrs(db, state, actorId);
  const actorFavor = state.standing[actorId]?.affection ?? 50;

  const candidates = collectCandidates(
    db, state, actorId, office, guirenOrder, year, month,
    actorAttrs.personality, actorFavor,
  );
  if (candidates.length === 0) return null;

  // 按绝对分降序，同分时按 tie-break hash 升序（确定性）。
  candidates.sort((a, b) => {
    const diff = Math.abs(b.score) - Math.abs(a.score);
    return diff !== 0 ? diff : a.tieBreak - b.tieBreak;
  });

  const top = candidates[0]!;
  return {
    actorId,
    office,
    targetId: top.charId,
    direction: top.direction,
    fromRankId: top.fromRankId,
    toRankId: top.toRankId,
    reason: resolveReason(top),
    score: top.score,
  };
}
