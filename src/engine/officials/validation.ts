/**
 * 官员/家族/亲缘的集中完整性校验（spec §14 + review F3/F4）。收集式（不首错即停），每条诊断
 * 带足够上下文。纯函数；供测试、开局自检（createNewGameState fail-fast）与存档加载（readSlot）复用。
 * Zod 只管形状，跨集合不变量一律在此处。
 */
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import type { FamilyMemberRole, GameState, PersonSex } from "../state/types";
import { isValidOfficialAge, isValidParentChildAge, isValidSpouseAge } from "./constraints";

/** 角色（FamilyMember.role）应有的性别。 */
const ROLE_SEX: Record<FamilyMemberRole, PersonSex> = {
  matriarch: "female",
  daughter: "female",
  sister: "female",
  consort_in: "male",
  son: "male",
};

function consortContent(state: GameState, db: ContentDB, id: string) {
  const c = db.characters[id] ?? state.generatedConsorts[id];
  return c && c.kind === "consort" ? c : undefined;
}

function ageOf(state: GameState, db: ContentDB, personId: string): number | undefined {
  return (
    state.officials[personId]?.age ??
    state.familyMembers[personId]?.age ??
    (db.characters[personId] ?? state.generatedConsorts[personId])?.profile.age
  );
}

/** 人物性别：官员=女；家族成员看 sex；侍君=男（女尊男侍）。未知返回 undefined。 */
function sexOf(state: GameState, db: ContentDB, personId: string): PersonSex | undefined {
  if (state.officials[personId]) return "female";
  const m = state.familyMembers[personId];
  if (m) return m.sex;
  if (consortContent(state, db, personId)) return "male";
  return undefined;
}

/** 人物的 canonical 家族归属（唯一真相）：官员/成员看 familyId；侍君看 standing.birthFamilyId。 */
function canonicalFamilyOf(state: GameState, db: ContentDB, personId: string): string | undefined {
  if (state.officials[personId]) return state.officials[personId]!.familyId;
  if (state.familyMembers[personId]) return state.familyMembers[personId]!.familyId;
  if (consortContent(state, db, personId)) return state.standing[personId]?.birthFamilyId;
  return undefined;
}

function personExists(state: GameState, db: ContentDB, personId: string): boolean {
  return (
    state.officials[personId] !== undefined ||
    state.familyMembers[personId] !== undefined ||
    db.characters[personId] !== undefined ||
    state.generatedConsorts[personId] !== undefined
  );
}

export function validateOfficialWorld(state: GameState, db: ContentDB): GameError[] {
  const errors: GameError[] = [];
  const e = (code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, message, context ? { context } : undefined));

  // ── 全局人物 id 唯一：authored characters / generatedConsorts / officials / familyMembers ──
  const namespaces: Array<[string, Iterable<string>]> = [
    ["character", Object.keys(db.characters)],
    ["generatedConsort", Object.keys(state.generatedConsorts)],
    ["official", Object.keys(state.officials)],
    ["familyMember", Object.keys(state.familyMembers)],
  ];
  const idOwner = new Map<string, string>();
  for (const [ns, ids] of namespaces) {
    for (const id of ids) {
      const prev = idOwner.get(id);
      if (prev !== undefined) e("PERSON_DUP_ID", `人物 id「${id}」在 ${prev} 与 ${ns} 重复`, { id });
      else idOwner.set(id, ns);
    }
  }

  // ── record key 与对象内部 id 必须一致 ──
  for (const [key, o] of Object.entries(state.officials)) {
    if (o.id !== key) e("OFFICIAL_KEY_MISMATCH", `officials["${key}"].id = "${o.id}"（键不一致）`, { key, id: o.id });
  }
  for (const [key, f] of Object.entries(state.officialFamilies)) {
    if (f.id !== key) e("FAMILY_KEY_MISMATCH", `officialFamilies["${key}"].id = "${f.id}"（键不一致）`, { key, id: f.id });
  }
  for (const [key, m] of Object.entries(state.familyMembers)) {
    if (m.id !== key) e("MEMBER_KEY_MISMATCH", `familyMembers["${key}"].id = "${m.id}"（键不一致）`, { key, id: m.id });
  }

  // ── 官员 ──
  const seatUse: Record<string, number> = {};
  for (const o of Object.values(state.officials)) {
    if (o.postId !== null) {
      if (!db.officialPosts[o.postId]) {
        e("OFFICIAL_BAD_POST", `官员「${o.id}」引用了不存在的官职「${o.postId}」`, { officialId: o.id, postId: o.postId });
      } else {
        seatUse[o.postId] = (seatUse[o.postId] ?? 0) + 1;
      }
    }
    if (!state.officialFamilies[o.familyId]) {
      e("OFFICIAL_BAD_FAMILY", `官员「${o.id}」引用了不存在的家族「${o.familyId}」`, { officialId: o.id, familyId: o.familyId });
    }
    // 只有 active 官员可占职（postId 非空）；其余状态占职即错（生命周期前置不变量）。
    if (o.status !== "active" && o.postId !== null) {
      e("OFFICIAL_INACTIVE_SEATED", `非在任官员「${o.id}」(${o.status}) 仍占官职「${o.postId}」`, { officialId: o.id, status: o.status });
    }
    if (!isValidOfficialAge(o.age)) {
      e("OFFICIAL_BAD_AGE", `官员「${o.id}」年龄不合规（${o.age}）`, { officialId: o.id, age: o.age });
    }
  }
  for (const [postId, used] of Object.entries(seatUse)) {
    const cap = db.officialPosts[postId]?.seatCount ?? 1;
    if (used > cap) e("OFFICIAL_SEAT_OVERFLOW", `官职「${postId}」在任 ${used} 人，超出席位 ${cap}`, { postId, used, cap });
  }

  // ── 家族成员 ──
  for (const m of Object.values(state.familyMembers)) {
    if (!state.officialFamilies[m.familyId]) {
      e("MEMBER_BAD_FAMILY", `家族成员「${m.id}」引用了不存在的家族「${m.familyId}」`, { memberId: m.id, familyId: m.familyId });
    }
    if (ROLE_SEX[m.role] !== m.sex) {
      e("MEMBER_SEX_ROLE", `家族成员「${m.id}」身份「${m.role}」与性别「${m.sex}」不一致`, { memberId: m.id, role: m.role, sex: m.sex });
    }
  }

  // ── 家族 surname 一致：本族官员 + 非内卿母系成员同姓（内卿可异姓赘入） ──
  for (const fam of Object.values(state.officialFamilies)) {
    for (const o of Object.values(state.officials)) {
      if (o.familyId === fam.id && o.surname !== fam.surname) {
        e("FAMILY_SURNAME_MISMATCH", `家族「${fam.id}」官员「${o.id}」姓「${o.surname}」≠ 族姓「${fam.surname}」`, { familyId: fam.id, officialId: o.id });
      }
    }
    for (const m of Object.values(state.familyMembers)) {
      if (m.familyId === fam.id && m.role !== "consort_in" && m.surname !== fam.surname) {
        e("FAMILY_SURNAME_MISMATCH", `家族「${fam.id}」成员「${m.id}」姓「${m.surname}」≠ 族姓「${fam.surname}」`, { familyId: fam.id, memberId: m.id });
      }
    }
  }

  // ── 侍君 birthFamilyId / maternalClan 一致 ──
  for (const [charId, s] of Object.entries(state.standing)) {
    if (s.birthFamilyId !== undefined && !state.officialFamilies[s.birthFamilyId]) {
      e("CONSORT_BAD_FAMILY", `侍君「${charId}」birthFamilyId「${s.birthFamilyId}」无对应家族`, { charId, familyId: s.birthFamilyId });
    }
    const content = consortContent(state, db, charId);
    const clan = content?.maternalClan;
    if (clan) {
      if (clan.familyId !== s.birthFamilyId) {
        e("CONSORT_CLAN_FAMILY", `侍君「${charId}」maternalClan.familyId「${clan.familyId}」≠ birthFamilyId「${s.birthFamilyId ?? "无"}」`, { charId });
      }
      // 必须存在与关系模型一致的母亲边：consort → 某官员(mother)，且该官员属 clan.familyId。
      const motherEdge = state.kinship.find((k) => k.fromPersonId === charId && k.type === "mother");
      const motherFam = motherEdge ? state.officials[motherEdge.toPersonId]?.familyId : undefined;
      if (!motherEdge || motherFam !== clan.familyId) {
        e("CONSORT_NO_MOTHER_EDGE", `侍君「${charId}」缺少指向母族「${clan.familyId}」官员的 mother 边`, { charId, familyId: clan.familyId });
      }
    }
  }

  // ── 亲缘边 ──
  const edgeKey = (from: string, to: string, type: string) => `${from}|${to}|${type}`;
  const present = new Set<string>();
  for (const k of state.kinship) present.add(edgeKey(k.fromPersonId, k.toPersonId, k.type));
  const has = (from: string, to: string, type: string) => present.has(edgeKey(from, to, type));

  const seenEdges = new Set<string>();
  const motherOf = new Map<string, string>();
  for (const k of state.kinship) {
    if (!personExists(state, db, k.fromPersonId)) e("KIN_BAD_FROM", `亲缘边起点「${k.fromPersonId}」不是有效人物`, { edge: k });
    if (!personExists(state, db, k.toPersonId)) e("KIN_BAD_TO", `亲缘边终点「${k.toPersonId}」不是有效人物`, { edge: k });

    const key = edgeKey(k.fromPersonId, k.toPersonId, k.type);
    if (seenEdges.has(key)) e("KIN_DUP_EDGE", `重复亲缘边 ${key}`, { edge: k });
    seenEdges.add(key);

    if (k.type === "mother") {
      const child = k.fromPersonId;
      const mom = k.toPersonId;
      const prev = motherOf.get(child);
      if (prev !== undefined && prev !== mom) {
        e("KIN_MULTI_MOTHER", `人物「${child}」有两个生母（${prev} / ${mom}）`, { personId: child });
      }
      motherOf.set(child, mom);

      // 反向边类型须与 child 实际性别严格匹配：male→son、female→daughter。
      const childSex = sexOf(state, db, child);
      if (childSex === "male" && !has(mom, child, "son")) {
        e("KIN_NO_REVERSE", `male child「${child}」缺正确反向 son 边（${mom}→${child}）`, { edge: k });
      }
      if (childSex === "female" && !has(mom, child, "daughter")) {
        e("KIN_NO_REVERSE", `female child「${child}」缺正确反向 daughter 边（${mom}→${child}）`, { edge: k });
      }

      // 家族归属一致：child 与 mother 的 canonical familyId 若均定义，必须相等。
      const cfChild = canonicalFamilyOf(state, db, child);
      const cfMom = canonicalFamilyOf(state, db, mom);
      if (cfChild !== undefined && cfMom !== undefined && cfChild !== cfMom) {
        e("KIN_FAMILY_MISMATCH", `母子家族不一致：「${child}」(${cfChild}) vs 母「${mom}」(${cfMom})`, { edge: k });
      }

      const childAge = ageOf(state, db, child);
      const motherAge = ageOf(state, db, mom);
      if (childAge !== undefined && motherAge !== undefined && !isValidParentChildAge(motherAge, childAge)) {
        e("KIN_BAD_AGE", `母「${mom}」(${motherAge}) 与子女「${child}」(${childAge}) 年龄关系不合理`, { edge: k });
      }
    }
    if (k.type === "daughter" || k.type === "son") {
      // {from: parent, to: child}：child 性别须与边类型匹配，且有反向 mother 边。
      const childSex = sexOf(state, db, k.toPersonId);
      if (k.type === "daughter" && childSex === "male") {
        e("KIN_REVERSE_SEX", `daughter 边指向男性「${k.toPersonId}」`, { edge: k });
      }
      if (k.type === "son" && childSex === "female") {
        e("KIN_REVERSE_SEX", `son 边指向女性「${k.toPersonId}」`, { edge: k });
      }
      if (!has(k.toPersonId, k.fromPersonId, "mother")) {
        e("KIN_NO_REVERSE", `${k.type} 边缺反向 mother（${k.toPersonId} → ${k.fromPersonId}）`, { edge: k });
      }
    }
    if (k.type === "sibling" || k.type === "spouse") {
      if (!has(k.toPersonId, k.fromPersonId, k.type)) {
        e("KIN_NOT_SYMMETRIC", `${k.type} 边不对称（缺 ${k.toPersonId} → ${k.fromPersonId}）`, { edge: k });
      }
    }
    if (k.type === "spouse") {
      const a = ageOf(state, db, k.fromPersonId);
      const b = ageOf(state, db, k.toPersonId);
      if (a !== undefined && b !== undefined && !isValidSpouseAge(a, b)) {
        e("KIN_BAD_SPOUSE_AGE", `配偶「${k.fromPersonId}」(${a}) 与「${k.toPersonId}」(${b}) 年龄差不合理`, { edge: k });
      }
    }
  }

  return errors;
}
