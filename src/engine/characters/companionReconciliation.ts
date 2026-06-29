/**
 * 伴读底座：评分、择定、幂等协调器。
 *
 * 核心规则：
 *  1. 皇子(daughter)配女性伴读，皇郎(son)配男性伴读；
 *  2. 官员家族候选优先年龄差 ±2，其次 ±3；宗室回退最多 ±2；
 *  3. 皇嗣庇护力影响所配伴读的家世。
 *
 * 本模块无 AP、无 EventEffect、无玩家交互。协调器是伴读增删的唯一写入路径。
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

const COMPANION_MIN_AGE = 4;
const AGE_GAP_PREFERRED = 2;
const AGE_GAP_EXTENDED = 3;
const ROYAL_AGE_GAP = 1;
const ROYAL_AGE_GAP_MAX = 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function jitter(seed: string, range: number): number {
  return (gestationRollRaw(seed) % (range * 2 + 1)) - range;
}

function derivePersonality(seed: string): HeirPersonality {
  const roll = (suffix: string) => clamp(40 + (gestationRollRaw(`${seed}:${suffix}`) % 41), 0, 100);
  return {
    empathy: roll("emp"),
    guile: roll("gui"),
    restraint: roll("res"),
    sociability: roll("soc"),
    assertiveness: roll("ass"),
    curiosity: roll("cur"),
  };
}

/** 皇子(daughter)→女伴读；皇郎(son)→男伴读。 */
export function companionSexForHeir(heir: Heir): PersonSex {
  return heir.sex === "daughter" ? "female" : "male";
}

function normalizeRankOrder(order: number): number {
  return clamp(Math.round((Math.min(order, 200) / 200) * 100), 0, 100);
}

function normalizeGradeOrder(gradeOrder: number): number {
  return clamp(Math.round((gradeOrder / 18) * 100), 0, 100);
}

/** 官员家族子弟的稳定嫡庶、排行与人格派生。 */
export function deriveFamilyYouthProfile(
  state: GameState,
  member: FamilyMember,
): FamilyYouthProfile {
  const seed = `companion-profile:${state.rngSeed}:${member.id}`;
  const siblings = Object.values(state.familyMembers)
    .filter(
      (candidate) =>
        candidate.familyId === member.familyId &&
        candidate.sex === member.sex &&
        (candidate.role === "daughter" || candidate.role === "son"),
    )
    .sort((a, b) => (b.age !== a.age ? b.age - a.age : a.id.localeCompare(b.id)));
  const birthOrder = Math.max(0, siblings.findIndex((candidate) => candidate.id === member.id));

  // 嫡庶是出生身份，不因内卿后来死亡而漂移。
  const hasConsortIn = Object.values(state.familyMembers).some(
    (candidate) => candidate.familyId === member.familyId && candidate.role === "consort_in",
  );
  const legitimate = hasConsortIn
    ? birthOrder === 0 || gestationRollRaw(`${seed}:legit`) % 2 === 0
    : false;

  return {
    legitimate,
    birthOrder,
    personality: derivePersonality(`${seed}:pers`),
  };
}

/** 皇嗣庇护力：养父地位、恩宠与母族，加上皇嗣自身恩宠和嫡出身份。 */
export function computePatronage(db: ContentDB, state: GameState, heirId: string): number {
  const heir = state.resources.bloodline.heirs.find((candidate) => candidate.id === heirId);
  if (!heir) return 0;

  const custodianStanding = heir.adoptiveFatherId
    ? state.standing[heir.adoptiveFatherId]
    : undefined;
  const rank = custodianStanding ? db.ranks[custodianStanding.rank] : undefined;
  const familyId = custodianStanding?.birthFamilyId;
  const family = familyId ? state.officialFamilies[familyId] : undefined;

  const raw =
    (rank ? normalizeRankOrder(rank.order) : 0) * 0.30 +
    (custodianStanding?.favor ?? 0) * 0.25 +
    (custodianStanding?.peakFavor ?? 0) * 0.10 +
    (family?.influence ?? 0) * 0.10 +
    heir.favor * 0.15 +
    (heir.legitimate ? 10 : 0);
  return clamp(raw, 0, 100);
}

function motherPostPrestige(db: ContentDB, state: GameState, familyId: string): number {
  let bestGrade = 0;
  for (const official of Object.values(state.officials)) {
    if (official.familyId !== familyId || official.status !== "active" || !official.postId) continue;
    const post = db.officialPosts[official.postId];
    if (post) bestGrade = Math.max(bestGrade, post.gradeOrder);
  }
  return normalizeGradeOrder(bestGrade);
}

function computeFamilyQuality(db: ContentDB, state: GameState, familyId: string): number {
  const family = state.officialFamilies[familyId];
  if (!family) return 0;
  return clamp(
    family.influence * 0.45 +
      motherPostPrestige(db, state, familyId) * 0.30 +
      family.imperialFavor * 0.25,
    0,
    100,
  );
}

function computeMatchScore(
  db: ContentDB,
  state: GameState,
  member: FamilyMember,
  heirId: string,
  heirAgeValue: number,
  patronage: number,
): number {
  const familyQuality = computeFamilyQuality(db, state, member.familyId);
  const profile = deriveFamilyYouthProfile(state, member);
  const ageBonus = Math.max(0, 10 - Math.abs(member.age - heirAgeValue) * 3);
  const legitimacyBonus = profile.legitimate ? 8 : 0;
  const stableJitter = jitter(`match:${state.rngSeed}:${member.id}:${heirId}`, 5);
  return clamp(
    100 - Math.abs(familyQuality - patronage) + ageBonus + legitimacyBonus + stableJitter,
    0,
    130,
  );
}

function baseEligibleFamilyMembers(
  state: GameState,
  heir: Heir,
  allocated: Set<string>,
): FamilyMember[] {
  const expectedSex = companionSexForHeir(heir);
  return Object.values(state.familyMembers).filter((member) => {
    if (member.deceasedAt || member.age < COMPANION_MIN_AGE) return false;
    if (member.role !== "daughter" && member.role !== "son") return false;
    if (member.sex !== expectedSex || allocated.has(member.id)) return false;
    return true;
  });
}

function tieredCandidates(base: FamilyMember[], heirAgeValue: number): FamilyMember[] {
  const preferred = base.filter((member) => Math.abs(member.age - heirAgeValue) <= AGE_GAP_PREFERRED);
  if (preferred.length > 0) return preferred;
  return base.filter((member) => Math.abs(member.age - heirAgeValue) <= AGE_GAP_EXTENDED);
}

function royalBranchForPatronage(
  patronage: number,
  seed: string,
): { branch: RoyalRelative["branch"]; branchPrestige: number } {
  if (patronage >= 75) {
    return { branch: "close", branchPrestige: 75 + (gestationRollRaw(`${seed}:bp`) % 21) };
  }
  if (patronage >= 45) {
    return { branch: "collateral", branchPrestige: 45 + (gestationRollRaw(`${seed}:bp`) % 31) };
  }
  return { branch: "distant", branchPrestige: 20 + (gestationRollRaw(`${seed}:bp`) % 31) };
}

/** 同年已故 fallback 不复用；按 ordinal 找首个空缺或仍在世者。 */
function resolveRoyalFallbackId(
  state: GameState,
  heir: Heir,
  now: GameTime,
): { id: string; reuse: RoyalRelative | null } {
  const base = `royal_youth_${heir.id}_${now.year}`;
  for (let ordinal = 1; ; ordinal += 1) {
    const id = ordinal === 1 ? base : `${base}_${ordinal}`;
    const existing = state.royalRelatives[id];
    if (!existing) return { id, reuse: null };
    if (existing.lifecycle === "alive") return { id, reuse: existing };
  }
}

/** 无合适官员家族子弟时生成或复用宗室青年。 */
export function buildRoyalFallbackCompanion(
  state: GameState,
  heir: Heir,
  heirAgeValue: number,
  patronage: number,
  now: GameTime,
): RoyalRelative {
  const { id, reuse } = resolveRoyalFallbackId(state, heir, now);
  if (reuse) return reuse;

  const seed = `royal-fallback:${state.rngSeed}:${id}`;
  const sex = companionSexForHeir(heir);
  const rawDelta =
    (gestationRollRaw(`${seed}:age`) % (ROYAL_AGE_GAP_MAX * 2 + 1)) - ROYAL_AGE_GAP_MAX;
  const clampedDelta = clamp(rawDelta, -ROYAL_AGE_GAP_MAX, ROYAL_AGE_GAP_MAX);
  const finalDelta =
    Math.abs(clampedDelta) > ROYAL_AGE_GAP && gestationRollRaw(`${seed}:narrow`) % 2 === 0
      ? Math.sign(clampedDelta) * ROYAL_AGE_GAP
      : clampedDelta;
  const age = Math.max(COMPANION_MIN_AGE, heirAgeValue + finalDelta);
  const { branch, branchPrestige } = royalBranchForPatronage(patronage, seed);

  const surnamePool = ["永", "庄", "端", "睿", "惠", "宁", "澄", "昭"];
  const femaleNames = ["瑾", "琰", "曦", "瑜", "琬", "媛", "婉", "瑶"];
  const maleNames = ["琮", "煦", "珩", "璟", "玦", "瑀", "琛", "琢"];
  const namePool = sex === "female" ? femaleNames : maleNames;
  const name = `${surnamePool[gestationRollRaw(`${seed}:sn`) % surnamePool.length]}${
    namePool[gestationRollRaw(`${seed}:nm`) % namePool.length]
  }`;

  return {
    id,
    name,
    sex,
    age,
    branch,
    branchPrestige: clamp(branchPrestige, 0, 100),
    legitimate: gestationRollRaw(`${seed}:legit`) % 4 !== 0,
    personality: derivePersonality(`${seed}:pers`),
    lifecycle: "alive",
  };
}

/** 除稳定关系 id 外的 active assignment 草案；id 由 apply 的单调序列分配。 */
export type CompanionAssignmentDraft = Omit<HeirCompanionAssignment, "id">;

function buildAssignmentFromFamilyMember(
  state: GameState,
  member: FamilyMember,
  heirId: string,
  now: GameTime,
): CompanionAssignmentDraft {
  const profile = deriveFamilyYouthProfile(state, member);
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
      familyName: state.officialFamilies[member.familyId]?.surname,
      familyRole: member.role,
    },
  };
}

function buildAssignmentFromRoyalRelative(
  relative: RoyalRelative,
  heirId: string,
  now: GameTime,
): CompanionAssignmentDraft {
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

export function companionIsAlive(state: GameState, assignment: HeirCompanionAssignment): boolean {
  if (assignment.companion.kind === "family_member") {
    return !state.familyMembers[assignment.companion.personId]?.deceasedAt;
  }
  return state.royalRelatives[assignment.companion.personId]?.lifecycle === "alive";
}

export interface CompanionView {
  name: string;
  age: number;
  sex: PersonSex;
  legitimate: boolean;
  source: "family_member" | "royal_relative";
  familyName?: string;
  bond: number;
}

/** 展示年龄与姓名读取 live 人物；来源缺失时回退 assignment 快照。 */
export function resolveCompanionView(
  state: GameState,
  assignment: HeirCompanionAssignment,
): CompanionView {
  let age = assignment.ageAtAssignment;
  let name = assignment.profile.name;
  if (assignment.companion.kind === "family_member") {
    const member = state.familyMembers[assignment.companion.personId];
    if (member) {
      age = member.age;
      name = member.name;
    }
  } else {
    const relative = state.royalRelatives[assignment.companion.personId];
    if (relative) {
      age = relative.age;
      name = relative.name;
    }
  }
  return {
    name,
    age,
    sex: assignment.profile.sex,
    legitimate: assignment.profile.legitimate,
    source: assignment.companion.kind,
    familyName: assignment.profile.familyName,
    bond: assignment.bond,
  };
}

export interface EndedAssignment {
  heirId: string;
  /** 被结束的关系 id；用于拒绝过期 plan 对较新关系的操作。 */
  assignmentId: string;
  reason: CompanionEndReason;
}

export interface CompanionReconciliationPlan {
  newAssignments: CompanionAssignmentDraft[];
  endedAssignments: EndedAssignment[];
  newRoyalRelatives: RoyalRelative[];
}

/** 每次时间结算后的纯规划：结束离校/亡故关系，并为在读且空缺者择定伴读。 */
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

  const students = state.resources.bloodline.heirs
    .filter((heir) => heir.birthAt && isWenzhaoStudent(heir, now))
    .map((heir) => ({ heir, patronage: computePatronage(db, state, heir.id) }))
    .sort((a, b) =>
      b.patronage !== a.patronage
        ? b.patronage - a.patronage
        : a.heir.id.localeCompare(b.heir.id),
    );
  const studentIds = new Set(students.map(({ heir }) => heir.id));

  const endedHeirIds = new Set<string>();
  for (const [heirId, assignment] of Object.entries(state.heirCompanions)) {
    if (assignment.status !== "active") continue;
    if (!studentIds.has(heirId)) {
      plan.endedAssignments.push({
        heirId,
        assignmentId: assignment.id,
        reason: "heir_left_school",
      });
      endedHeirIds.add(heirId);
    } else if (!companionIsAlive(state, assignment)) {
      plan.endedAssignments.push({
        heirId,
        assignmentId: assignment.id,
        reason: "companion_deceased",
      });
      endedHeirIds.add(heirId);
    }
  }

  const allocated = new Set(
    Object.values(state.heirCompanions)
      .filter((assignment) => assignment.status === "active" && !endedHeirIds.has(assignment.heirId))
      .map((assignment) => assignment.companion.personId),
  );

  for (const { heir, patronage } of students) {
    const existing = state.heirCompanions[heir.id];
    const needsCompanion = !existing || existing.status !== "active" || endedHeirIds.has(heir.id);
    if (!needsCompanion) continue;

    const age = heirAge(heir, now);
    const candidates = tieredCandidates(baseEligibleFamilyMembers(state, heir, allocated), age);
    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) =>
        computeMatchScore(db, state, b, heir.id, age, patronage) >
        computeMatchScore(db, state, a, heir.id, age, patronage)
          ? b
          : a,
      );
      plan.newAssignments.push(buildAssignmentFromFamilyMember(state, best, heir.id, now));
      allocated.add(best.id);
      continue;
    }

    const relative = buildRoyalFallbackCompanion(state, heir, age, patronage, now);
    if (allocated.has(relative.id)) continue;
    plan.newAssignments.push(buildAssignmentFromRoyalRelative(relative, heir.id, now));
    if (!state.royalRelatives[relative.id]) plan.newRoyalRelatives.push(relative);
    allocated.add(relative.id);
  }

  return plan;
}

export function companionAssignmentId(heirId: string, seq: number): string {
  return `companion_assignment_${heirId}_${seq}`;
}

function companionAssignmentSequence(id: string): number | null {
  const match = /^companion_assignment_.+_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * 不可变应用 reconciliation plan。
 *
 * - 结束操作仅匹配 plan 中的 assignmentId，过期 plan 不会结束较新关系；
 * - 新关系只写入空槽位，过期 plan 不会无历史覆盖现任关系；
 * - seq 会防御性越过已有正式 id，并检测精确碰撞。
 */
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

  const active = { ...state.heirCompanions };
  const history = [...state.endedCompanionAssignments];
  const royalRelatives = { ...state.royalRelatives };
  let seq = state.nextCompanionAssignmentSeq;

  for (const { heirId, assignmentId, reason } of plan.endedAssignments) {
    const current = active[heirId];
    if (!current || current.id !== assignmentId) continue;
    history.push({ ...current, status: "ended", endedAt: now, endReason: reason });
    delete active[heirId];
  }

  for (const relative of plan.newRoyalRelatives) {
    royalRelatives[relative.id] = relative;
  }

  const usedAssignmentIds = new Set([
    ...Object.values(active).map((assignment) => assignment.id),
    ...history.map((assignment) => assignment.id),
  ]);
  for (const id of usedAssignmentIds) {
    const usedSeq = companionAssignmentSequence(id);
    if (usedSeq !== null) seq = Math.max(seq, usedSeq + 1);
  }

  for (const draft of plan.newAssignments) {
    // 任何现任关系都说明 plan 已过期或已应用；绝不直接覆盖。
    if (active[draft.heirId]) continue;

    let id = companionAssignmentId(draft.heirId, seq);
    while (usedAssignmentIds.has(id)) {
      seq += 1;
      id = companionAssignmentId(draft.heirId, seq);
    }
    seq += 1;
    usedAssignmentIds.add(id);
    active[draft.heirId] = { ...draft, id };
  }

  return {
    ...state,
    heirCompanions: active,
    endedCompanionAssignments: history,
    royalRelatives,
    nextCompanionAssignmentSeq: seq,
  };
}

export function getActiveCompanion(
  state: GameState,
  heirId: string,
): HeirCompanionAssignment | undefined {
  return state.heirCompanions[heirId];
}

/** 历任伴读按结束时刻倒序。GameTime.dayIndex 是权威绝对旬序。 */
export function getFormerCompanions(
  state: GameState,
  heirId: string,
): HeirCompanionAssignment[] {
  return state.endedCompanionAssignments
    .filter((assignment) => assignment.heirId === heirId)
    .sort(
      (a, b) =>
        (b.endedAt?.dayIndex ?? b.assignedAt.dayIndex) -
        (a.endedAt?.dayIndex ?? a.assignedAt.dayIndex),
    );
}

export function getCompanionAssignmentById(
  state: GameState,
  assignmentId: string,
): HeirCompanionAssignment | undefined {
  for (const assignment of Object.values(state.heirCompanions)) {
    if (assignment.id === assignmentId) return assignment;
  }
  return state.endedCompanionAssignments.find((assignment) => assignment.id === assignmentId);
}
