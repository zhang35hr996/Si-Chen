/**
 * 伴读底座：评分、择定、幂等协调器。
 * 规则：每名在读皇嗣至多一名 active 伴读；官员家族子弟优先，不够时生成宗室青年。
 * 本模块无 AP、无玩家交互——只修改 state.heirCompanions / royalRelatives / pendingCompanionAppointments。
 */
import { gestationRollRaw } from "./gestation";
import { heirAge, isWenzhaoStudent } from "./heirs";
import type { GameTime } from "../calendar/time";
import type { GameState, FamilyMember, HeirCompanionAssignment, RoyalRelative, HeirPersonality } from "../state/types";

// ── 常数 ──────────────────────────────────────────────────────────────────────

const COMPANION_MIN_AGE = 4;
const COMPANION_MAX_AGE_DIFF = 5;

// ── 派生辅助 ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function jitter(seed: string, range: number): number {
  return (gestationRollRaw(seed) % (range * 2 + 1)) - range;
}

function derivePersonality(seed: string): HeirPersonality {
  const roll = (s: string) => clamp(40 + (gestationRollRaw(s) % 41), 0, 100);
  return {
    empathy: roll(seed + ":emp"),
    guile: roll(seed + ":gui"),
    restraint: roll(seed + ":res"),
    sociability: roll(seed + ":soc"),
    assertiveness: roll(seed + ":ass"),
    curiosity: roll(seed + ":cur"),
  };
}

/** 家族子弟的嫡庶派生（deterministic per member + game seed）。 */
export function deriveFamilyYouthProfile(
  rngSeed: number,
  member: FamilyMember,
): { legitimate: boolean; personality: HeirPersonality } {
  const seed = `companion-profile:${rngSeed}:${member.id}`;
  const legitimate = gestationRollRaw(seed + ":legit") % 3 !== 0; // 67% 嫡出
  return { legitimate, personality: derivePersonality(seed + ":pers") };
}

// ── 评分 ──────────────────────────────────────────────────────────────────────

/**
 * 皇嗣庇护力：反映养父政治资本对伴读位置的吸引力。
 * custodianRankScore = reviewState.merit (官员履历实力代理)。
 */
export function computePatronage(state: GameState, heirId: string): number {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir) return 0;

  const custodianId = heir.adoptiveFatherId;
  const custodian = custodianId ? state.officials[custodianId] : undefined;
  const custodianStanding = custodianId ? state.standing[custodianId] : undefined;

  const custodianRankScore = custodian?.reviewState.merit ?? 0;
  const custodianFavor = custodianStanding?.favor ?? 0;
  const custodianPeakFavor = custodianStanding?.peakFavor ?? 0;
  const custodianFamily = custodian ? state.officialFamilies[custodian.familyId] : undefined;
  const custodianFamilyPower = custodianFamily?.influence ?? 0;
  const heirFavor = heir.favor;
  const legitimateBonus = heir.legitimate ? 10 : 0;

  const raw =
    custodianRankScore * 0.30 +
    custodianFavor * 0.25 +
    custodianPeakFavor * 0.10 +
    custodianFamilyPower * 0.10 +
    heirFavor * 0.15 +
    legitimateBonus;

  return clamp(raw, 0, 100);
}

/** 官员家族的门第质量分。 */
function computeFamilyQuality(state: GameState, familyId: string): number {
  const family = state.officialFamilies[familyId];
  if (!family) return 0;
  // motherPostPrestige: 暂用 imperialFavor 加权代理（无独立母亲职位字段）
  const motherPostPrestige = family.imperialFavor;
  const raw = family.influence * 0.45 + motherPostPrestige * 0.30 + family.imperialFavor * 0.25;
  return clamp(raw, 0, 100);
}

/** 伴读候选人与皇嗣的配对得分。分高=更适合。 */
function computeMatchScore(
  state: GameState,
  member: FamilyMember,
  heirId: string,
  heirAge_: number,
  patronage: number,
  rngSeed: number,
): number {
  const family = member.familyId ? state.officialFamilies[member.familyId] : undefined;
  const familyQuality = family ? computeFamilyQuality(state, member.familyId) : 0;
  const profile = deriveFamilyYouthProfile(rngSeed, member);

  const ageDiff = Math.abs(member.age - heirAge_);
  const ageClosenessBonus = Math.max(0, 10 - ageDiff * 2);
  const legitimateBonus = profile.legitimate ? 8 : 0;
  const j = jitter(`match:${rngSeed}:${member.id}:${heirId}`, 5);

  return clamp(100 - Math.abs(familyQuality - patronage) + ageClosenessBonus + legitimateBonus + j, 0, 130);
}

// ── 候选筛选 ──────────────────────────────────────────────────────────────────

/** 活着、年龄合适、未已作为伴读的家族子弟。 */
function eligibleFamilyMembers(
  state: GameState,
  heirId: string,
  heirAge_: number,
): FamilyMember[] {
  const activeCompanionPersonIds = new Set(
    Object.values(state.heirCompanions)
      .filter((a) => a.status === "active" && a.heirId !== heirId)
      .map((a) => a.companion.personId),
  );

  return Object.values(state.familyMembers).filter((m) => {
    if (m.deceasedAt) return false;
    if (m.age < COMPANION_MIN_AGE) return false;
    if (Math.abs(m.age - heirAge_) > COMPANION_MAX_AGE_DIFF) return false;
    if (m.role !== "daughter" && m.role !== "son") return false;
    if (activeCompanionPersonIds.has(m.id)) return false;
    return true;
  });
}

// ── 宗室回退 ─────────────────────────────────────────────────────────────────

/** 当无合适官员家族候选时，生成（或复用已有）宗室伴读。 */
export function buildRoyalFallbackCompanion(
  state: GameState,
  heirId: string,
  heirAge_: number,
  now: GameTime,
): RoyalRelative {
  const existingId = `royal_youth_${heirId}_${now.year}`;
  if (state.royalRelatives[existingId]) {
    return state.royalRelatives[existingId]!;
  }

  const seed = `royal-fallback:${state.rngSeed}:${heirId}:${now.year}`;
  const roll = (s: string, lo: number, hi: number) =>
    lo + (gestationRollRaw(seed + s) % (hi - lo + 1));

  const sexRoll = gestationRollRaw(seed + ":sex") % 2;
  const sex = sexRoll === 0 ? ("female" as const) : ("male" as const);
  const ageDelta = (gestationRollRaw(seed + ":age") % (COMPANION_MAX_AGE_DIFF * 2 + 1)) - COMPANION_MAX_AGE_DIFF;
  const age = Math.max(COMPANION_MIN_AGE, heirAge_ + ageDelta);
  const branchRoll = gestationRollRaw(seed + ":branch") % 3;
  const branch = (["close", "collateral", "distant"] as const)[branchRoll]!;
  const branchPrestige = roll(":prestige", 20, 70);
  const legitimate = gestationRollRaw(seed + ":legit") % 4 !== 0; // 75%嫡出
  const personality = derivePersonality(seed + ":pers");

  const surnamePool = ["永", "庄", "端", "睿", "惠", "宁", "澄", "昭"];
  const namePool = ["瑾", "琰", "澄", "曦", "瑜", "熠", "琮", "煦"];
  const si = gestationRollRaw(seed + ":sn") % surnamePool.length;
  const ni = gestationRollRaw(seed + ":nm") % namePool.length;
  const name = `${surnamePool[si]}${namePool[ni]}`;

  return {
    id: existingId,
    name,
    sex,
    age,
    branch,
    branchPrestige,
    legitimate,
    personality,
    lifecycle: "alive",
  };
}

// ── 伴读 assignment 构建 ────────────────────────────────────────────────────

function buildAssignmentFromFamilyMember(
  state: GameState,
  member: FamilyMember,
  heirId: string,
  rngSeed: number,
  now: GameTime,
): HeirCompanionAssignment {
  const profile = deriveFamilyYouthProfile(rngSeed, member);
  const family = state.officialFamilies[member.familyId];
  return {
    heirId,
    companion: { kind: "family_member", personId: member.id },
    assignedAt: now,
    status: "active",
    bond: 0,
    profile: {
      name: member.name,
      sex: member.sex,
      age: member.age,
      legitimate: profile.legitimate,
      personality: profile.personality,
      familyName: family?.surname,
      familyRole: member.role,
    },
  };
}

function buildAssignmentFromRoyalRelative(
  relative: RoyalRelative,
  heirId: string,
  now: GameTime,
): HeirCompanionAssignment {
  return {
    heirId,
    companion: { kind: "royal_relative", personId: relative.id },
    assignedAt: now,
    status: "active",
    bond: 0,
    profile: {
      name: relative.name,
      sex: relative.sex,
      age: relative.age,
      legitimate: relative.legitimate,
      personality: relative.personality,
    },
  };
}

// ── 幂等协调器 ────────────────────────────────────────────────────────────────

export interface CompanionReconciliationPlan {
  newAssignments: HeirCompanionAssignment[];
  endedHeirIds: string[];
  newRoyalRelatives: RoyalRelative[];
  newAppointments: import("../state/types").CompanionAppointmentReport[];
}

/**
 * 每次时间结算后调用一次。幂等：已有 active 伴读的皇嗣跳过；
 * 不扣 AP，不产生 EventEffect，结果由 applyCompanionReconciliation 写入 state。
 */
export function planCompanionReconciliation(
  state: GameState,
  now: GameTime,
): CompanionReconciliationPlan {
  const plan: CompanionReconciliationPlan = {
    newAssignments: [],
    endedHeirIds: [],
    newRoyalRelatives: [],
    newAppointments: [],
  };

  // 计算所有在读皇嗣（patronage 降序，id 升序 stable sort）
  const students = state.resources.bloodline.heirs
    .filter((h) => h.birthAt && isWenzhaoStudent(h, now))
    .map((h) => ({ heir: h, patronage: computePatronage(state, h.id) }))
    .sort((a, b) =>
      b.patronage !== a.patronage ? b.patronage - a.patronage : a.heir.id.localeCompare(b.heir.id),
    );

  // 结束已离校皇嗣的伴读
  for (const [heirId, assignment] of Object.entries(state.heirCompanions)) {
    if (assignment.status !== "active") continue;
    const still = students.some((s) => s.heir.id === heirId);
    if (!still) {
      plan.endedHeirIds.push(heirId);
    }
  }

  // 为还没有 active 伴读的在读皇嗣择定
  // 维护一个本次已分配的人物集合（不与已有 active 重复）
  const allocated = new Set<string>(
    Object.values(state.heirCompanions)
      .filter((a) => a.status === "active" && !plan.endedHeirIds.includes(a.heirId))
      .map((a) => a.companion.personId),
  );

  for (const { heir, patronage } of students) {
    const existing = state.heirCompanions[heir.id];
    if (existing?.status === "active" && !plan.endedHeirIds.includes(heir.id)) continue;

    const age = heirAge(heir, now);
    const candidates = eligibleFamilyMembers(state, heir.id, age).filter(
      (m) => !allocated.has(m.id),
    );

    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) => {
        const sa = computeMatchScore(state, a, heir.id, age, patronage, state.rngSeed);
        const sb = computeMatchScore(state, b, heir.id, age, patronage, state.rngSeed);
        return sb > sa ? b : a;
      });

      const assignment = buildAssignmentFromFamilyMember(state, best, heir.id, state.rngSeed, now);
      plan.newAssignments.push(assignment);
      plan.newAppointments.push({
        heirId: heir.id,
        companion: { kind: "family_member", personId: best.id },
        createdAt: now,
        acknowledged: false,
      });
      allocated.add(best.id);
    } else {
      // 宗室回退
      const relative = buildRoyalFallbackCompanion(state, heir.id, age, now);
      if (!allocated.has(relative.id)) {
        const assignment = buildAssignmentFromRoyalRelative(relative, heir.id, now);
        plan.newAssignments.push(assignment);
        plan.newAppointments.push({
          heirId: heir.id,
          companion: { kind: "royal_relative", personId: relative.id },
          createdAt: now,
          acknowledged: false,
        });
        plan.newRoyalRelatives.push(relative);
        allocated.add(relative.id);
      }
    }
  }

  return plan;
}

/** state 变换：将 plan 写入 state（直接 mutate，外层负责 immer/copy）。 */
export function applyCompanionReconciliation(
  state: GameState,
  plan: CompanionReconciliationPlan,
  now: GameTime,
): void {
  for (const heirId of plan.endedHeirIds) {
    const a = state.heirCompanions[heirId];
    if (a) {
      a.status = "ended";
      a.endedAt = now;
      a.endReason = "heir_left_school";
    }
  }
  for (const rel of plan.newRoyalRelatives) {
    state.royalRelatives[rel.id] = rel;
  }
  for (const assignment of plan.newAssignments) {
    state.heirCompanions[assignment.heirId] = assignment;
  }
  for (const appt of plan.newAppointments) {
    state.pendingCompanionAppointments.push(appt);
  }
}
