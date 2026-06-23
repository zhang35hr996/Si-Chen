/**
 * 官员/家族/亲缘的只读查询（spec §5）。纯函数，绝不修改 state、绝不消耗随机数、
 * 绝不靠姓名临时推断亲缘——一切走正式 id 与亲缘边。供引擎、校验器与 UI selector 共用。
 */
import type { ContentDB } from "../content/loader";
import type {
  FamilyMember,
  GameState,
  KinshipRelation,
  Official,
  OfficialFamily,
  PersonSex,
} from "../state/types";

export type ResolvedPersonKind = "official" | "consort" | "member";

export interface ResolvedPerson {
  id: string;
  kind: ResolvedPersonKind;
  name: string;
  sex: PersonSex;
  age?: number;
  familyId?: string;
  /** 是否当前在宫的侍君（有 standing）。 */
  inPalace?: boolean;
}

/** 解析任意 personId（官员 / 宫中侍君 charId / 家族成员）为统一只读视图；未知则 undefined。 */
export function resolvePerson(state: GameState, db: ContentDB, personId: string): ResolvedPerson | undefined {
  const official = state.officials[personId];
  if (official) {
    return { id: personId, kind: "official", name: `${official.surname}${official.givenName}`, sex: "female", age: official.age, familyId: official.familyId };
  }
  const member = state.familyMembers[personId];
  if (member) {
    return { id: personId, kind: "member", name: member.name, sex: member.sex, age: member.age, familyId: member.familyId };
  }
  const consort = db.characters[personId] ?? state.generatedConsorts[personId];
  if (consort) {
    // 侍君为男性侍御。母族经 standing.birthFamilyId 关联。
    return {
      id: personId,
      kind: "consort",
      name: consort.profile.name,
      sex: "male",
      age: consort.profile.age,
      familyId: state.standing[personId]?.birthFamilyId,
      inPalace: state.standing[personId] !== undefined,
    };
  }
  return undefined;
}

/** personId 所属家族（官员/家族成员看自身 familyId；侍君看 standing.birthFamilyId）。 */
export function getFamilyByPersonId(state: GameState, personId: string): OfficialFamily | undefined {
  const official = state.officials[personId];
  if (official) return state.officialFamilies[official.familyId];
  const member = state.familyMembers[personId];
  if (member) return state.officialFamilies[member.familyId];
  const birthFamilyId = state.standing[personId]?.birthFamilyId;
  if (birthFamilyId) return state.officialFamilies[birthFamilyId];
  return undefined;
}

/** 某家族的全部官员（一族可有多名官员）。 */
export function getOfficialsByFamilyId(state: GameState, familyId: string): Official[] {
  return Object.values(state.officials).filter((o) => o.familyId === familyId);
}

/**
 * 当前「在任且有有效官职」的官员（status=active、postId 非空且官职存在）。
 * 依赖在任官员的系统（殿选世家候选来源、大臣进献）必须经此 selector 取人，
 * 以免后续引入 retired/dead/exiled 后仍从已故/告老者中抽取。
 */
export function getActiveSeatedOfficials(state: GameState, db: ContentDB): Official[] {
  return Object.values(state.officials).filter(
    (o) => o.status === "active" && o.postId !== null && db.officialPosts[o.postId] !== undefined,
  );
}

/** 某家族出身、当前在宫的侍君 charId（按 standing.birthFamilyId）。 */
export function getConsortsByFamilyId(state: GameState, familyId: string): string[] {
  return Object.entries(state.standing)
    .filter(([, s]) => s.birthFamilyId === familyId)
    .map(([id]) => id);
}

/** 某家族的家族成员（非官员、非在宫侍君）。 */
export function getFamilyMembers(state: GameState, familyId: string): FamilyMember[] {
  return Object.values(state.familyMembers).filter((m) => m.familyId === familyId);
}

/** 某人物的全部亲缘边（出边：type 描述「对端相对于 personId」的身份）。 */
export function getCloseRelatives(state: GameState, personId: string): KinshipRelation[] {
  return state.kinship.filter((k) => k.fromPersonId === personId);
}

/** 某官员的宫中侍君亲属（同族在宫侍君）。无背景则返回空数组。 */
export function getPalaceRelativesOfOfficial(state: GameState, officialId: string): string[] {
  const official = state.officials[officialId];
  if (!official) return [];
  return getConsortsByFamilyId(state, official.familyId);
}

/** 某侍君的官员亲属（其母族中的官员）。无官员背景则返回空数组（不报错）。 */
export function getOfficialRelativesOfConsort(state: GameState, consortId: string): Official[] {
  const birthFamilyId = state.standing[consortId]?.birthFamilyId;
  if (!birthFamilyId) return [];
  return getOfficialsByFamilyId(state, birthFamilyId);
}
