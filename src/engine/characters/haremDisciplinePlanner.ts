/**
 * 后宫内部惩戒结算（PUNISH-4G-B）。
 *
 * 纯函数：不修改 state，不产生副作用。
 * 确定性：同一 state 必然产生同一结果（fnv1a64Hex 种子）。
 */
import type { ContentDB } from "../content/loader";
import type {
  GameState,
  HaremDisciplineKind,
  HaremDisciplineActorSnapshot,
  HaremDisciplineTargetSnapshot,
} from "../state/types";
import { monthOrdinal } from "../calendar/time";
import { fnv1a64Hex } from "../save/canonical";
import { isConfined } from "./confinement";
import { isInColdPalace, hasColdPalaceMadness } from "./coldPalace";
import { resolveConsortRuntimeAttrs } from "./consortAttrs";
import { imperialProtectionSnapshot, isCurrentCarrier } from "./imperialProtection";
import { getHaremFactionId } from "./factionSelectors";
import { haremRankStepDistance } from "./haremRankLadder";

// ── 常量 ──────────────────────────────────────────────────────────────────────

const DISCIPLINE_THRESHOLD = 25;
/** 目标侍君受罚冷却（含当月），单位：月序差。 */
const DISCIPLINE_TARGET_COOLDOWN_MONTHS = 2;
const AXIS_CAP = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── 快照 ──────────────────────────────────────────────────────────────────────

function buildActorSnapshot(
  db: ContentDB,
  state: GameState,
  actorId: string,
): HaremDisciplineActorSnapshot {
  const st = state.standing[actorId]!;
  const ps = imperialProtectionSnapshot(db, state, actorId);
  const admin = state.haremAdministration;
  const isHaremAdministrator =
    (st.rank === "huanghou" && admin.mode === "empress") ||
    (admin.mode === "acting_consort" && admin.charId === actorId);
  return {
    rankId: st.rank,
    favor: st.favor,
    peakFavor: st.peakFavor,
    imperialProtectionScore: ps.score,
    isHaremAdministrator,
  };
}

function buildTargetSnapshot(
  db: ContentDB,
  state: GameState,
  targetId: string,
): HaremDisciplineTargetSnapshot {
  const st = state.standing[targetId]!;
  const ps = imperialProtectionSnapshot(db, state, targetId);
  return {
    rankId: st.rank,
    favor: st.favor,
    peakFavor: st.peakFavor,
    imperialProtectionScore: ps.score,
    isCarrying: isCurrentCarrier(state, targetId),
    healthBefore: st.health ?? 100,
  };
}

// ── 资格检查 ──────────────────────────────────────────────────────────────────

function isActorEligible(db: ContentDB, state: GameState, actorId: string): boolean {
  const st = state.standing[actorId];
  if (!st) return false;
  if (st.lifecycle === "deceased" || st.lifecycle === "candidate") return false;
  if (!(actorId in state.bedchamber)) return false;
  const rank = db.ranks[st.rank];
  if (!rank || rank.domain !== "harem") return false;
  const fuRank = db.ranks["fu"];
  if (!fuRank) return false;
  if (rank.order < fuRank.order) return false;
  if (isConfined(state, actorId)) return false;
  if (isInColdPalace(state, actorId)) return false;
  if (hasColdPalaceMadness(state, actorId)) return false;
  if ((st.healthStatus ?? "healthy") === "critical") return false;
  // Actor cooldown: cannot act again within 2 months of a prior discipline they initiated.
  const currentOrd = monthOrdinal(state.calendar);
  const recentAsActor = state.haremDisciplineIncidents.some(
    (i) => i.actorId === actorId && currentOrd - monthOrdinal(i.occurredAt) <= DISCIPLINE_TARGET_COOLDOWN_MONTHS,
  );
  if (recentAsActor) return false;
  return true;
}

function isTargetEligible(
  db: ContentDB,
  state: GameState,
  targetId: string,
  actorId: string,
): boolean {
  if (targetId === actorId) return false;
  const st = state.standing[targetId];
  if (!st) return false;
  if (st.lifecycle === "deceased" || st.lifecycle === "candidate") return false;
  if (!(targetId in state.bedchamber)) return false;
  const rank = db.ranks[st.rank];
  if (!rank || rank.domain !== "harem") return false;
  if (st.rank === "huanghou") return false;
  if (isInColdPalace(state, targetId)) return false;
  if (hasColdPalaceMadness(state, targetId)) return false;
  if (isConfined(state, targetId)) return false;
  if ((st.healthStatus ?? "healthy") === "critical") return false;
  if (
    state.haremDisciplineIncidents.some(
      (i) => i.targetId === targetId && i.status === "pending_response",
    )
  )
    return false;
  const now = state.calendar;
  const currentOrd = monthOrdinal(now);
  const recentAsTarget = state.haremDisciplineIncidents.some((i) => {
    if (i.targetId !== targetId) return false;
    return currentOrd - monthOrdinal(i.occurredAt) <= DISCIPLINE_TARGET_COOLDOWN_MONTHS;
  });
  if (recentAsTarget) return false;
  return true;
}

// ── pairScore 组件 ─────────────────────────────────────────────────────────────

function actorDriveScore(db: ContentDB, state: GameState, actorId: string): number {
  const attrs = resolveConsortRuntimeAttrs(db, state, actorId);
  const { ambition, personality } = attrs;
  const { jealousy, scheming, pride, courage, compassion, emotionalStability } = personality;
  const raw = (ambition + jealousy + scheming + pride + courage - compassion - emotionalStability) / 20;
  return clamp(Math.round(raw), -10, 25);
}

function officeBonus(state: GameState, actorId: string): number {
  const admin = state.haremAdministration;
  const st = state.standing[actorId];
  if (!st) return 0;
  if (st.rank === "huanghou" && admin.mode === "empress") return 16;
  if (admin.mode === "acting_consort" && admin.charId === actorId) return 10;
  return 0;
}

function protectionDelta(actorScore: number, targetScore: number): number {
  return clamp(actorScore - targetScore, -30, 30);
}

function relationModifier(db: ContentDB, state: GameState, actorId: string, targetId: string): number {
  const char = db.characters[actorId] ?? state.generatedConsorts[actorId];
  if (!char || char.kind !== "consort") return 0;
  const stance = char.stances?.find((s) => s.charId === targetId)?.stance ?? "neutral";
  switch (stance) {
    case "contemptuous": return 12;
    case "hostile": return 15;
    case "competitive": return 6;
    case "neutral": return 0;
    case "friendly": return -8;
    case "devoted": return -15;
    default: return 0;
  }
}

function factionModifier(state: GameState, actorId: string, targetId: string): number {
  const actorFaction = getHaremFactionId(state, actorId);
  const targetFaction = getHaremFactionId(state, targetId);
  if (actorFaction === undefined || targetFaction === undefined) return 0;
  return actorFaction === targetFaction ? -10 : 5;
}

/**
 * 盛宠修正：actor 有历史高帝眷时，倾向于攻击当前盛宠（嫉妒）或失宠的新宠（落井下石）。
 * target 自身受到 protectionDelta 保护；此函数反映 actor 的主动动机，不重复给予 target 保护分。
 */
function favoriteModifier(db: ContentDB, state: GameState, actorId: string, targetId: string): number {
  const targetPs = imperialProtectionSnapshot(db, state, targetId);
  const actorSt = state.standing[actorId];
  if (!actorSt) return 0;
  const actorIsHighFavor = actorSt.favor >= 60 || actorSt.peakFavor >= 60;
  if (targetPs.favoriteStatus === "current_new_favorite") {
    // 若 actor 自身恩宠深厚，嫉妒心驱动攻击；否则轻微收手（新宠惹不起）。
    return actorIsHighFavor ? 8 : -5;
  }
  if (targetPs.favoriteStatus === "fallen_new_favorite") {
    // 失宠后可能遭落井下石，但仅限曾受帝眷的 actor。
    return actorIsHighFavor ? 4 : 0;
  }
  return 0;
}

// ── 惩戒种类选择 ──────────────────────────────────────────────────────────────

function selectDisciplineKind(
  actorAttrs: ReturnType<typeof resolveConsortRuntimeAttrs>,
  actorRankOrder: number,
  fuRankOrder: number,
  rankSteps: number,
  pairScore: number,
  targetIsCarrying: boolean,
  targetHealth: number,
  targetHealthStatus: string,
): HaremDisciplineKind {
  const { courage, compassion } = actorAttrs.personality;
  const healthOk = targetHealthStatus === "healthy";
  if (
    rankSteps >= 5 &&
    pairScore >= 75 &&
    actorRankOrder > fuRankOrder &&
    courage >= 50 &&
    compassion <= 65 &&
    !targetIsCarrying &&
    targetHealth > 40 &&
    healthOk
  ) {
    return "slapping";
  }
  if (rankSteps >= 2 && pairScore >= 45 && !targetIsCarrying && targetHealth > 30 && healthOk) {
    return "kneeling";
  }
  return "copy_scripture";
}

// ── 健康值差 ──────────────────────────────────────────────────────────────────

export function disciplineHealthDelta(kind: HaremDisciplineKind, currentHealth: number): number {
  if (kind === "copy_scripture") return 0;
  const rawDelta = kind === "kneeling" ? -3 : -6;
  return Math.max(rawDelta, -(currentHealth - 1));
}

// ── 对外计划结构 ──────────────────────────────────────────────────────────────

export interface HaremDisciplinePlan {
  actorId: string;
  targetId: string;
  disciplineKind: HaremDisciplineKind;
  rankSteps: number;
  pairScore: number;
  actorSnapshot: HaremDisciplineActorSnapshot;
  targetSnapshot: HaremDisciplineTargetSnapshot;
  /** 目标受罚后健康变化量（≤0）。*/
  healthDelta: number;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 从当前 state 中选出最高优先级的后宫内部惩戒配对。
 * 返回 null 表示本月无合格配对。
 */
export function planHaremDiscipline(
  db: ContentDB,
  state: GameState,
): HaremDisciplinePlan | null {
  const { year, month } = state.calendar;
  const fuRankOrder = db.ranks["fu"]?.order ?? 0;

  interface Candidate {
    actorId: string;
    targetId: string;
    pairScore: number;
    rankSteps: number;
    roll: number;
    occurrenceChance: number;
    actorAttrs: ReturnType<typeof resolveConsortRuntimeAttrs>;
    actorRankOrder: number;
  }

  const candidates: Candidate[] = [];

  for (const [actorId] of Object.entries(state.standing)) {
    if (!isActorEligible(db, state, actorId)) continue;
    const actorSt = state.standing[actorId]!;
    const actorRank = db.ranks[actorSt.rank];
    if (!actorRank) continue;
    const actorAttrs = resolveConsortRuntimeAttrs(db, state, actorId);
    const actorProtScore = imperialProtectionSnapshot(db, state, actorId).score;

    for (const [targetId] of Object.entries(state.standing)) {
      if (!isTargetEligible(db, state, targetId, actorId)) continue;
      const targetSt = state.standing[targetId]!;
      const targetRank = db.ranks[targetSt.rank];
      if (!targetRank) continue;

      const rankSteps = haremRankStepDistance(db, actorSt.rank, targetSt.rank);
      if (rankSteps === null || rankSteps <= 0) continue;

      const targetProtScore = imperialProtectionSnapshot(db, state, targetId).score;

      const score =
        rankSteps * 10 +
        protectionDelta(actorProtScore, targetProtScore) +
        officeBonus(state, actorId) +
        clamp(actorDriveScore(db, state, actorId), -AXIS_CAP, AXIS_CAP) +
        clamp(relationModifier(db, state, actorId, targetId), -AXIS_CAP, AXIS_CAP) +
        clamp(factionModifier(state, actorId, targetId), -AXIS_CAP, AXIS_CAP) +
        clamp(favoriteModifier(db, state, actorId, targetId), -AXIS_CAP, AXIS_CAP);

      if (score < DISCIPLINE_THRESHOLD) continue;

      const occurrenceChance = clamp(10 + Math.floor((score - DISCIPLINE_THRESHOLD) / 3), 10, 45);
      const rollKey = `harem_discipline:${state.rngSeed}:${year}:${month}:${actorId}:${targetId}`;
      const hash = fnv1a64Hex(rollKey);
      const roll = parseInt(hash.slice(0, 8), 16) % 100;

      candidates.push({
        actorId,
        targetId,
        pairScore: score,
        rankSteps,
        roll,
        occurrenceChance,
        actorAttrs,
        actorRankOrder: actorRank.order,
      });
    }
  }

  // Select the single highest-scoring pair (deterministic), then roll once for it.
  // If that roll fails, no event this month — lower-ranked pairs get no second chance.
  candidates.sort(
    (a, b) =>
      b.pairScore - a.pairScore ||
      a.actorId.localeCompare(b.actorId) ||
      a.targetId.localeCompare(b.targetId),
  );

  if (candidates.length === 0) return null;

  const top = candidates[0]!;
  if (top.roll >= top.occurrenceChance) return null;
  const { actorId, targetId, rankSteps, pairScore, actorAttrs, actorRankOrder } = top;

  const actorSnapshot = buildActorSnapshot(db, state, actorId);
  const targetSnapshot = buildTargetSnapshot(db, state, targetId);

  const disciplineKind = selectDisciplineKind(
    actorAttrs,
    actorRankOrder,
    fuRankOrder,
    rankSteps,
    pairScore,
    targetSnapshot.isCarrying,
    targetSnapshot.healthBefore,
    state.standing[targetId]?.healthStatus ?? "healthy",
  );

  const healthDelta = disciplineHealthDelta(disciplineKind, targetSnapshot.healthBefore);

  return {
    actorId,
    targetId,
    disciplineKind,
    rankSteps,
    pairScore,
    actorSnapshot,
    targetSnapshot,
    healthDelta,
  };
}
