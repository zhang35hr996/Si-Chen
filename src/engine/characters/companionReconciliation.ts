/**
 * 伴读底座：评分、择定、幂等协调器。
 *
 * 核心规则（设计约束，必须落地）：
 *  1. 同性别——皇子(daughter)配女性伴读，皇郎(son)配男性伴读；
 *  2. 年龄相近——官员候选优先 ±2，其次 ±3；宗室回退 ±1（最多 ±2）；
 *  3. 养父地位决定家世——养父（侍君）位分/恩宠/母族越高，patronage 越高，
 *     越能匹配高门官员子弟或近支高位宗室。
 *
 * 本模块无 AP、无 EventEffect、无玩家交互——协调器是伴读增删的**唯一真相**，
 * 结果由 applyCompanionReconciliation 以不可变方式写入 state。
 */
import { gestationRollRaw } from "./gestation";
import { heirAge, isWenzhaoStudent } from "./heirs";
import type { ContentDB } from "../content/loader";
import type { GameTime } from "../calendar/time";
import type {
  CompanionEndReason,
  FamilyMember,
  FamilyYouthProfile,
  GameState,
  Heir,
  HeirCompanionAssignment,
  HeirPersonality,
  PersonSex,
  RoyalRelative,
} from "../state/types";

// ── 常数 ──────────────────────────────────────────────────────────────────────

const COMPANION_MIN_AGE = 4;
const AGE_GAP_PREFERRED = 2;
const AGE_GAP_EXTENDED = 3;
const ROYAL_AGE_GAP = 1; // fallback 优先 ±1
const ROYAL_AGE_GAP_MAX = 2; // 最多 ±2

// ── 基础辅助 ──────────────────────────────────────────────────────────────────

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

/** 皇嗣对应的伴读性别：皇子(daughter)→女，皇郎(son)→男。 */
export function companionSexForHeir(heir: Heir): PersonSex {
  return heir.sex === "daughter" ? "female" : "male";
}

/** 侍君位分序（order）归一化到 0–100。皇后=1000 截顶，其余按 ~200 量程缩放。 */
function normalizeRankOrder(order: number): number {
  // 实际位分 order：低位 ~52，高位 ~194，皇后 1000（离群）。以 200 为有效量程，截顶到 100。
  return clamp(Math.round((Math.min(order, 200) / 200) * 100), 0, 100);
}

/** 官职品级序（gradeOrder 0–18）归一化到 0–100。 */
function normalizeGradeOrder(gradeOrder: number): number {
  return clamp(Math.round((gradeOrder / 18) * 100), 0, 100);
}

// ── 嫡庶/排行派生 ────────────────────────────────────────────────────────────

/**
 * 家族子弟的嫡庶/排行/性格派生（deterministic per member + game seed）。
 *
 * 嫡出须以家族存在正室（consort_in）为前提；无正室则全为庶出。
 * 有正室时，同性别子女中年最长者（birthOrder 0）为嫡，其余概率派生。
 */
export function deriveFamilyYouthProfile(
  state: GameState,
  member: FamilyMember,
): FamilyYouthProfile {
  const seed = `companion-profile:${state.rngSeed}:${member.id}`;

  // 同家族、同性别子女排行（年龄降序 + 稳定 id）。
  const siblings = Object.values(state.familyMembers)
    .filter(
      (m) =>
        m.familyId === member.familyId &&
        m.sex === member.sex &&
        (m.role === "daughter" || m.role === "son"),
    )
    .sort((a, b) => (b.age !== a.age ? b.age - a.age : a.id.localeCompare(b.id)));
  const birthOrder = Math.max(0, siblings.findIndex((m) => m.id === member.id));

  const hasConsortIn = Object.values(state.familyMembers).some(
    (m) => m.familyId === member.familyId && m.role === "consort_in" && !m.deceasedAt,
  );

  let legitimate = false;
  if (hasConsortIn) {
    legitimate = birthOrder === 0 ? true : gestationRollRaw(seed + ":legit") % 2 === 0;
  }

  return { legitimate, birthOrder, personality: derivePersonality(seed + ":pers") };
}

// ── patronage（庇护力，养父侧）────────────────────────────────────────────────

/**
 * 皇嗣庇护力：养父（侍君）地位 + 皇嗣自身恩宠/嫡庶。养父经 state.standing 解析
 * （养父是侍君/太后，绝不在 state.officials 中）。
 */
export function computePatronage(db: ContentDB, state: GameState, heirId: string): number {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir) return 0;

  const custodianId = heir.adoptiveFatherId;
  const standing = custodianId ? state.standing[custodianId] : undefined;

  const rank = standing ? db.ranks[standing.rank] : undefined;
  const custodianRankScore = rank ? normalizeRankOrder(rank.order) : 0;
  const custodianFavor = standing?.favor ?? 0;
  const custodianPeakFavor = standing?.peakFavor ?? 0;

  const motherFamilyId = standing?.birthFamilyId;
  const motherFamily = motherFamilyId ? state.officialFamilies[motherFamilyId] : undefined;
  const custodianFamilyPower = motherFamily?.influence ?? 0;

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

// ── familyQuality（官员家族门第）──────────────────────────────────────────────

/** 家族在任母官的最高官职品级（gradeOrder 归一化 0–100）。无在任官则 0。 */
function motherPostPrestige(db: ContentDB, state: GameState, familyId: string): number {
  let best = 0;
  for (const o of Object.values(state.officials)) {
    if (o.familyId !== familyId) continue;
    if (o.status !== "active" || !o.postId) continue;
    const post = db.officialPosts[o.postId];
    if (post) best = Math.max(best, post.gradeOrder);
  }
  return normalizeGradeOrder(best);
}

/** 官员家族门第质量分。 */
function computeFamilyQuality(db: ContentDB, state: GameState, familyId: string): number {
  const family = state.officialFamilies[familyId];
  if (!family) return 0;
  const postPrestige = motherPostPrestige(db, state, familyId);
  const raw = family.influence * 0.45 + postPrestige * 0.30 + family.imperialFavor * 0.25;
  return clamp(raw, 0, 100);
}

// ── matchScore（候选与皇嗣的配对）────────────────────────────────────────────

function computeMatchScore(
  db: ContentDB,
  state: GameState,
  member: FamilyMember,
  heirId: string,
  heirAge_: number,
  patronage: number,
): number {
  const familyQuality = member.familyId ? computeFamilyQuality(db, state, member.familyId) : 0;
  const profile = deriveFamilyYouthProfile(state, member);

  const ageDiff = Math.abs(member.age - heirAge_);
  const ageClosenessBonus = Math.max(0, 10 - ageDiff * 3);
  const legitimateBonus = profile.legitimate ? 8 : 0;
  const j = jitter(`match:${state.rngSeed}:${member.id}:${heirId}`, 5);

  return clamp(100 - Math.abs(familyQuality - patronage) + ageClosenessBonus + legitimateBonus + j, 0, 130);
}

// ── 候选筛选（同性别 + 年龄分层）──────────────────────────────────────────────

/** 活着、同性别、未被他人占用、且未含本次已分配的家族子弟。 */
function baseEligibleFamilyMembers(
  state: GameState,
  heir: Heir,
  allocated: Set<string>,
): FamilyMember[] {
  const wantSex = companionSexForHeir(heir);
  return Object.values(state.familyMembers).filter((m) => {
    if (m.deceasedAt) return false;
    if (m.age < COMPANION_MIN_AGE) return false;
    if (m.role !== "daughter" && m.role !== "son") return false;
    if (m.sex !== wantSex) return false;
    if (allocated.has(m.id)) return false;
    return true;
  });
}

/** 分层年龄筛选：先 ±2，无则 ±3。返回候选（可能为空）。 */
function tieredCandidates(base: FamilyMember[], heirAge_: number): FamilyMember[] {
  const within = (gap: number) => base.filter((m) => Math.abs(m.age - heirAge_) <= gap);
  const preferred = within(AGE_GAP_PREFERRED);
  if (preferred.length > 0) return preferred;
  return within(AGE_GAP_EXTENDED);
}

// ── 宗室回退（按需生成；性别与等级受规则/ patronage 约束）──────────────────────

function royalBranchForPatronage(
  patronage: number,
  seed: string,
): { branch: RoyalRelative["branch"]; branchPrestige: number } {
  if (patronage >= 75) {
    return { branch: "close", branchPrestige: 75 + (gestationRollRaw(seed + ":bp") % 21) };
  }
  if (patronage >= 45) {
    return { branch: "collateral", branchPrestige: 45 + (gestationRollRaw(seed + ":bp") % 31) };
  }
  return { branch: "distant", branchPrestige: 20 + (gestationRollRaw(seed + ":bp") % 31) };
}

/** 当无合适官员家族候选时，生成（或复用已有）宗室伴读。性别同皇嗣规则；等级随 patronage。 */
export function buildRoyalFallbackCompanion(
  state: GameState,
  heir: Heir,
  heirAge_: number,
  patronage: number,
  now: GameTime,
): RoyalRelative {
  const existingId = `royal_youth_${heir.id}_${now.year}`;
  const existing = state.royalRelatives[existingId];
  if (existing) return existing;

  const seed = `royal-fallback:${state.rngSeed}:${heir.id}:${now.year}`;
  const sex = companionSexForHeir(heir);

  // 年龄优先 ±1，最多 ±2（启蒙期儿童的“年龄相近”）。
  const gapRange = ROYAL_AGE_GAP_MAX;
  const ageDelta = (gestationRollRaw(seed + ":age") % (gapRange * 2 + 1)) - gapRange;
  const clampedDelta = clamp(ageDelta, -ROYAL_AGE_GAP_MAX, ROYAL_AGE_GAP_MAX);
  // 偏好 ±1：若 |delta|>1 且掷出收束则拉回 ±1
  const finalDelta = Math.abs(clampedDelta) > ROYAL_AGE_GAP && gestationRollRaw(seed + ":narrow") % 2 === 0
    ? Math.sign(clampedDelta) * ROYAL_AGE_GAP
    : clampedDelta;
  const age = Math.max(COMPANION_MIN_AGE, heirAge_ + finalDelta);

  const { branch, branchPrestige } = royalBranchForPatronage(patronage, seed);
  const legitimate = gestationRollRaw(seed + ":legit") % 4 !== 0; // 75% 嫡出
  const personality = derivePersonality(seed + ":pers");

  const surnamePool = ["永", "庄", "端", "睿", "惠", "宁", "澄", "昭"];
  const namePoolF = ["瑾", "琰", "曦", "瑜", "琬", "媛", "婉", "瑶"];
  const namePoolM = ["琮", "煦", "珩", "璟", "玦", "瑀", "琛", "琢"];
  const pool = sex === "female" ? namePoolF : namePoolM;
  const si = gestationRollRaw(seed + ":sn") % surnamePool.length;
  const ni = gestationRollRaw(seed + ":nm") % pool.length;
  const name = `${surnamePool[si]}${pool[ni]}`;

  return {
    id: existingId,
    name,
    sex,
    age,
    branch,
    branchPrestige: clamp(branchPrestige, 0, 100),
    legitimate,
    personality,
    lifecycle: "alive",
  };
}

// ── assignment 构建 ──────────────────────────────────────────────────────────

function buildAssignmentFromFamilyMember(
  state: GameState,
  member: FamilyMember,
  heirId: string,
  now: GameTime,
): HeirCompanionAssignment {
  const profile = deriveFamilyYouthProfile(state, member);
  const family = state.officialFamilies[member.familyId];
  return {
    heirId,
    companion: { kind: "family_member", personId: member.id },
    assignedAt: now,
    status: "active",
    bond: 0,
    ageAtAssignment: member.age,
    profile: {
      name: member.name,
      sex: member.sex,
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
    ageAtAssignment: relative.age,
    profile: {
      name: relative.name,
      sex: relative.sex,
      legitimate: relative.legitimate,
      personality: relative.personality,
    },
  };
}

// ── 存活检查 ──────────────────────────────────────────────────────────────────

export function companionIsAlive(state: GameState, assignment: HeirCompanionAssignment): boolean {
  if (assignment.companion.kind === "family_member") {
    return !state.familyMembers[assignment.companion.personId]?.deceasedAt;
  }
  return state.royalRelatives[assignment.companion.personId]?.lifecycle === "alive";
}

// ── live 视图（解析当前年龄，避免快照漂移）────────────────────────────────────

export interface CompanionView {
  name: string;
  age: number;
  sex: PersonSex;
  legitimate: boolean;
  source: "family_member" | "royal_relative";
  familyName?: string;
  bond: number;
}

/** 解析伴读的展示视图：年龄取 live 来源，身份取快照。来源人物缺失时回退快照。 */
export function resolveCompanionView(
  state: GameState,
  assignment: HeirCompanionAssignment,
): CompanionView {
  let liveAge = assignment.ageAtAssignment;
  let liveName = assignment.profile.name;
  if (assignment.companion.kind === "family_member") {
    const m = state.familyMembers[assignment.companion.personId];
    if (m) { liveAge = m.age; liveName = m.name; }
  } else {
    const r = state.royalRelatives[assignment.companion.personId];
    if (r) { liveAge = r.age; liveName = r.name; }
  }
  return {
    name: liveName,
    age: liveAge,
    sex: assignment.profile.sex,
    legitimate: assignment.profile.legitimate,
    source: assignment.companion.kind,
    familyName: assignment.profile.familyName,
    bond: assignment.bond,
  };
}

// ── 幂等协调器 ────────────────────────────────────────────────────────────────

export interface EndedAssignment {
  heirId: string;
  reason: CompanionEndReason;
}

export interface CompanionReconciliationPlan {
  newAssignments: HeirCompanionAssignment[];
  endedAssignments: EndedAssignment[];
  newRoyalRelatives: RoyalRelative[];
}

/**
 * 每次时间结算后调用一次。幂等：
 *  - 仍在读、伴读仍在世 → 保持不变；
 *  - 皇嗣离校 → 结束（heir_left_school）；
 *  - 伴读身故 → 结束（companion_deceased），并在同一次为仍在读皇嗣补选替补；
 *  - 在读且无 active 伴读 → 择定。
 * 不扣 AP、不产生 EventEffect；结果由 applyCompanionReconciliation 写入。
 */
export function planCompanionReconciliation(
  db: ContentDB,
  state: GameState,
  now: GameTime,
): CompanionReconciliationPlan {
  const plan: CompanionReconciliationPlan = {
    newAssignments: [],
    endedAssignments: [],
    newRoyalRelatives: [],
  };

  // 在读皇嗣（patronage 降序，id 升序 stable sort）。
  const students = state.resources.bloodline.heirs
    .filter((h) => h.birthAt && isWenzhaoStudent(h, now))
    .map((h) => ({ heir: h, patronage: computePatronage(db, state, h.id) }))
    .sort((a, b) =>
      b.patronage !== a.patronage ? b.patronage - a.patronage : a.heir.id.localeCompare(b.heir.id),
    );
  const studentIds = new Set(students.map((s) => s.heir.id));

  // 1) 结束：离校 or 伴读身故。
  const endedHeirIds = new Set<string>();
  for (const [heirId, assignment] of Object.entries(state.heirCompanions)) {
    if (assignment.status !== "active") continue;
    if (!studentIds.has(heirId)) {
      plan.endedAssignments.push({ heirId, reason: "heir_left_school" });
      endedHeirIds.add(heirId);
    } else if (!companionIsAlive(state, assignment)) {
      plan.endedAssignments.push({ heirId, reason: "companion_deceased" });
      endedHeirIds.add(heirId);
    }
  }

  // 已占用的人物：现存仍有效的 active 伴读（排除本次将结束者）。
  const allocated = new Set<string>(
    Object.values(state.heirCompanions)
      .filter((a) => a.status === "active" && !endedHeirIds.has(a.heirId))
      .map((a) => a.companion.personId),
  );

  // 2) 择定：在读且（无 active 伴读 或 本次被结束）。
  for (const { heir, patronage } of students) {
    const existing = state.heirCompanions[heir.id];
    const needsCompanion =
      !existing || existing.status !== "active" || endedHeirIds.has(heir.id);
    if (!needsCompanion) continue;

    const age = heirAge(heir, now);
    const base = baseEligibleFamilyMembers(state, heir, allocated);
    const candidates = tieredCandidates(base, age);

    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) =>
        computeMatchScore(db, state, b, heir.id, age, patronage) >
        computeMatchScore(db, state, a, heir.id, age, patronage)
          ? b
          : a,
      );
      plan.newAssignments.push(buildAssignmentFromFamilyMember(state, best, heir.id, now));
      allocated.add(best.id);
    } else {
      const relative = buildRoyalFallbackCompanion(state, heir, age, patronage, now);
      if (!allocated.has(relative.id)) {
        plan.newAssignments.push(buildAssignmentFromRoyalRelative(relative, heir.id, now));
        if (!state.royalRelatives[relative.id]) plan.newRoyalRelatives.push(relative);
        allocated.add(relative.id);
      }
    }
  }

  return plan;
}

/** 不可变变换：返回应用 plan 后的新 state（绝不原地改输入或其嵌套对象）。 */
export function applyCompanionReconciliation(
  state: GameState,
  plan: CompanionReconciliationPlan,
  now: GameTime,
): GameState {
  if (
    plan.newAssignments.length === 0 &&
    plan.endedAssignments.length === 0 &&
    plan.newRoyalRelatives.length === 0
  ) {
    return state;
  }

  const heirCompanions = { ...state.heirCompanions };
  const royalRelatives = { ...state.royalRelatives };

  for (const { heirId, reason } of plan.endedAssignments) {
    const a = heirCompanions[heirId];
    if (a && a.status === "active") {
      heirCompanions[heirId] = { ...a, status: "ended", endedAt: now, endReason: reason };
    }
  }
  for (const rel of plan.newRoyalRelatives) {
    royalRelatives[rel.id] = rel;
  }
  for (const assignment of plan.newAssignments) {
    heirCompanions[assignment.heirId] = assignment;
  }

  return { ...state, heirCompanions, royalRelatives };
}
