/**
 * 官员/家族/亲缘的集中完整性校验（spec §14 + review F3/F4）。收集式（不首错即停），每条诊断
 * 带足够上下文。纯函数；供测试、开局自检与存档加载（readSlot）复用。Zod 只管形状，跨集合
 * 不变量一律在此处。
 */
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import type { FamilyMemberRole, GameState, PersonSex } from "../state/types";
import { isValidOfficialAge, isValidParentChildAge, isValidSpouseAge } from "./constraints";
import { getPalaceRelativesOfOfficial } from "./selectors";

/** 角色（FamilyMember.role）应有的性别。 */
const ROLE_SEX: Record<FamilyMemberRole, PersonSex> = {
  matriarch: "female",
  daughter: "female",
  sister: "female",
  consort_in: "male",
  son: "male",
};

function ageOf(state: GameState, db: ContentDB, personId: string): number | undefined {
  return (
    state.officials[personId]?.age ??
    state.familyMembers[personId]?.age ??
    (db.characters[personId] ?? state.generatedConsorts[personId])?.profile.age
  );
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
    if (o.status === "dead" && o.postId !== null) {
      e("OFFICIAL_DEAD_SEATED", `已故官员「${o.id}」仍占官职「${o.postId}」`, { officialId: o.id });
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

  // ── 侍君 birthFamilyId 指向有效家族 ──
  for (const [charId, s] of Object.entries(state.standing)) {
    if (s.birthFamilyId !== undefined && !state.officialFamilies[s.birthFamilyId]) {
      e("CONSORT_BAD_FAMILY", `侍君「${charId}」birthFamilyId「${s.birthFamilyId}」无对应家族`, { charId, familyId: s.birthFamilyId });
    }
  }

  // ── 亲缘边：端点存在 / 无重复 / 无矛盾生母 / 母女年龄 / 反向边 / 对称边 ──
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
      const prev = motherOf.get(k.fromPersonId);
      if (prev !== undefined && prev !== k.toPersonId) {
        e("KIN_MULTI_MOTHER", `人物「${k.fromPersonId}」有两个生母（${prev} / ${k.toPersonId}）`, { personId: k.fromPersonId });
      }
      motherOf.set(k.fromPersonId, k.toPersonId);
      // 反向边：母→子女（daughter 或 son）。
      if (!has(k.toPersonId, k.fromPersonId, "daughter") && !has(k.toPersonId, k.fromPersonId, "son")) {
        e("KIN_NO_REVERSE", `mother 边缺反向 daughter/son（${k.toPersonId} → ${k.fromPersonId}）`, { edge: k });
      }
      const childAge = ageOf(state, db, k.fromPersonId);
      const motherAge = ageOf(state, db, k.toPersonId);
      if (childAge !== undefined && motherAge !== undefined && !isValidParentChildAge(motherAge, childAge)) {
        e("KIN_BAD_AGE", `母「${k.toPersonId}」(${motherAge}) 与子女「${k.fromPersonId}」(${childAge}) 年龄关系不合理`, { edge: k });
      }
    }
    if (k.type === "daughter" || k.type === "son") {
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

  // ── 官员↔宫中亲属反向一致：官员的宫中亲属，其母族必含该官员所属家族 ──
  for (const o of Object.values(state.officials)) {
    for (const consortId of getPalaceRelativesOfOfficial(state, o.id)) {
      if (state.standing[consortId]?.birthFamilyId !== o.familyId) {
        e("KIN_ASYMMETRIC", `官员「${o.id}」与宫中亲属「${consortId}」家族归属不一致`, { officialId: o.id, consortId });
      }
    }
  }

  return errors;
}
