import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);

describe("validateOfficialWorld", () => {
  it("clean generated world has no errors", () => {
    expect(validateOfficialWorld(createNewGameState(db, 1), db)).toEqual([]);
  });

  it("catches a corrupt official post reference", () => {
    const s = createNewGameState(db, 1);
    const id = Object.keys(s.officials)[0]!;
    s.officials[id] = { ...s.officials[id]!, postId: "no_such_post" };
    expect(codes(s)).toContain("OFFICIAL_BAD_POST");
  });

  it("catches a missing family reference", () => {
    const s = createNewGameState(db, 1);
    const id = Object.keys(s.officials)[0]!;
    s.officials[id] = { ...s.officials[id]!, familyId: "fam_9999" };
    expect(codes(s)).toContain("OFFICIAL_BAD_FAMILY");
  });

  it("catches seat overflow on a single-seat post", () => {
    const s = createNewGameState(db, 1);
    const [a, b] = Object.keys(s.officials);
    // chengxiang 是单席正一品。
    s.officials[a!] = { ...s.officials[a!]!, postId: "chengxiang" };
    s.officials[b!] = { ...s.officials[b!]!, postId: "chengxiang" };
    expect(codes(s)).toContain("OFFICIAL_SEAT_OVERFLOW");
  });

  it("catches a consort birthFamilyId pointing at no family", () => {
    const s = createNewGameState(db, 1);
    s.standing["shen_zhibai"] = { ...s.standing["shen_zhibai"]!, birthFamilyId: "fam_9999" };
    expect(codes(s)).toContain("CONSORT_BAD_FAMILY");
  });

  it("catches a conflicting second mother", () => {
    const s = createNewGameState(db, 1);
    const me = s.kinship.find((k) => k.type === "mother")!;
    // 选一个不同于现有生母的官员作第二生母。
    const otherMother = Object.keys(s.officials).find((id) => id !== me.toPersonId)!;
    s.kinship = [...s.kinship, { fromPersonId: me.fromPersonId, toPersonId: otherMother, type: "mother" }];
    expect(codes(s)).toContain("KIN_MULTI_MOTHER");
  });

  it("catches a duplicate id across entities", () => {
    const s = createNewGameState(db, 1);
    const memberId = Object.keys(s.familyMembers)[0]!;
    // 让某官员与某家族成员撞 id。
    s.officials[memberId] = { ...Object.values(s.officials)[0]!, id: memberId };
    expect(codes(s)).toContain("PERSON_DUP_ID");
  });

  it.each(["dead", "retired", "imprisoned", "exiled"] as const)(
    "catches a non-active (%s) official still seated",
    (status) => {
      const s = createNewGameState(db, 1);
      const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
      s.officials[seated.id] = { ...seated, status };
      expect(codes(s)).toContain("OFFICIAL_INACTIVE_SEATED");
    },
  );

  it("catches a cross-family mother edge (familyId inconsistency)", () => {
    const s = createNewGameState(db, 1);
    // 取沈氏一名生成子女，把其 mother 边改指向别族官员。
    const child = s.kinship.find((k) => k.type === "mother" && state_officialFamily(s, k.toPersonId) === "fam_shen_main")?.fromPersonId
      ?? s.kinship.find((k) => k.type === "mother")!.fromPersonId;
    const otherOfficial = Object.values(s.officials).find((o) => o.familyId !== "fam_shen_main")!;
    s.kinship = s.kinship
      .filter((k) => !(k.fromPersonId === child && k.type === "mother"))
      .concat([{ fromPersonId: child, toPersonId: otherOfficial.id, type: "mother" }]);
    expect(codes(s)).toContain("KIN_FAMILY_MISMATCH");
  });

  it("catches a daughter reverse edge pointing at a male child", () => {
    const s = createNewGameState(db, 1);
    const sonEdge = s.kinship.find((k) => k.type === "son");
    if (!sonEdge) return; // 该 seed 无男郎则跳过（其它 seed 覆盖）
    s.kinship = s.kinship.map((k) =>
      k.fromPersonId === sonEdge.fromPersonId && k.toPersonId === sonEdge.toPersonId && k.type === "son"
        ? { ...k, type: "daughter" as const }
        : k,
    );
    expect(codes(s)).toContain("KIN_REVERSE_SEX");
  });

  it("catches maternalClan.familyId disagreeing with birthFamilyId", () => {
    const s = createNewGameState(db, 1);
    s.standing["shen_zhibai"] = { ...s.standing["shen_zhibai"]!, birthFamilyId: "fam_lu_main" };
    expect(codes(s)).toContain("CONSORT_CLAN_FAMILY");
  });

  it("catches a family surname mismatch", () => {
    const s = createNewGameState(db, 1);
    const head = s.officials["official_fam_shen_main"]!;
    s.officials[head.id] = { ...head, surname: "X" };
    expect(codes(s)).toContain("FAMILY_SURNAME_MISMATCH");
  });

  it("catches a male person used as a mother", () => {
    const s = createNewGameState(db, 1);
    // shen_zhibai 为男性侍君，绝不可作 mother。
    const child = Object.values(s.officials)[0]!.id;
    s.kinship = [...s.kinship, { fromPersonId: child, toPersonId: "shen_zhibai", type: "mother" }];
    expect(codes(s)).toContain("KIN_MOTHER_NOT_FEMALE");
  });

  it("catches a record-key / id mismatch", () => {
    const s = createNewGameState(db, 1);
    const [k, o] = Object.entries(s.officials)[0]!;
    s.officials[k] = { ...o, id: "official_relabelled" };
    expect(codes(s)).toContain("OFFICIAL_KEY_MISMATCH");
  });

  it("catches a member referencing a missing family (ownership)", () => {
    const s = createNewGameState(db, 1);
    const m = Object.values(s.familyMembers)[0]!;
    s.familyMembers[m.id] = { ...m, familyId: "fam_9999" };
    expect(codes(s)).toContain("MEMBER_BAD_FAMILY");
  });

  it("catches a sex/role mismatch", () => {
    const s = createNewGameState(db, 1);
    const son = Object.values(s.familyMembers).find((m) => m.role === "son");
    const target = son ?? Object.values(s.familyMembers)[0]!;
    s.familyMembers[target.id] = { ...target, sex: target.sex === "male" ? "female" : "male" };
    expect(codes(s)).toContain("MEMBER_SEX_ROLE");
  });

  it("catches a kinship endpoint that is not a real person", () => {
    const s = createNewGameState(db, 1);
    s.kinship = [...s.kinship, { fromPersonId: "ghost_a", toPersonId: "ghost_b", type: "sibling" }];
    expect(codes(s)).toContain("KIN_BAD_FROM");
  });

  it("catches a missing reverse edge for mother", () => {
    const s = createNewGameState(db, 1);
    // 删掉某条 daughter/son 反向边，使其对应 mother 边失去反向。
    const mother = s.kinship.find((k) => k.type === "mother")!;
    s.kinship = s.kinship.filter(
      (k) => !(k.fromPersonId === mother.toPersonId && k.toPersonId === mother.fromPersonId && (k.type === "daughter" || k.type === "son")),
    );
    expect(codes(s)).toContain("KIN_NO_REVERSE");
  });

  it("catches a non-symmetric sibling/spouse edge", () => {
    const s = createNewGameState(db, 1);
    const sym = s.kinship.find((k) => k.type === "sibling" || k.type === "spouse")!;
    s.kinship = s.kinship.filter((k) => !(k.fromPersonId === sym.toPersonId && k.toPersonId === sym.fromPersonId && k.type === sym.type));
    expect(codes(s)).toContain("KIN_NOT_SYMMETRIC");
  });

  it("catches a global person id collision across namespaces", () => {
    const s = createNewGameState(db, 1);
    // 让某官员 id 撞上 authored character id。
    const charId = Object.keys(db.characters)[0]!;
    s.officials[charId] = { ...Object.values(s.officials)[0]!, id: charId };
    expect(codes(s)).toContain("PERSON_DUP_ID");
  });
});

/** 测试辅助：person 的 canonical 家族（仅取官员/成员，够用）。 */
function state_officialFamily(s: ReturnType<typeof createNewGameState>, id: string): string | undefined {
  return s.officials[id]?.familyId ?? s.familyMembers[id]?.familyId;
}
