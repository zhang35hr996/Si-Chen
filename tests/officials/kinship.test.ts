import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  getCloseRelatives,
  getConsortsByFamilyId,
  getFamilyByPersonId,
  getOfficialRelativesOfConsort,
  getOfficialsByFamilyId,
  getPalaceRelativesOfOfficial,
  resolvePerson,
} from "../../src/engine/officials/selectors";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
// shen_zhibai is now event_only; inject her so kinship tests referencing her birthFamilyId work
const state = withConsort(createNewGameState(db, 1), db, "shen_zhibai");

// 沈氏母族：显式 familyId（content 声明 fam_shen_main）。
const SHEN_FAMILY = "fam_shen_main";
const SHEN_HEAD = "official_fam_shen_main";

describe("kinship queries — consort ⇄ official", () => {
  it("从侍君查到母族", () => {
    expect(getFamilyByPersonId(state, "shen_zhibai")?.id).toBe(SHEN_FAMILY);
  });

  it("从侍君查到官员亲属（含当家官员，同姓）", () => {
    const officials = getOfficialRelativesOfConsort(state, "shen_zhibai");
    expect(officials.map((o) => o.id)).toContain(SHEN_HEAD);
    expect(officials.every((o) => o.surname === "沈")).toBe(true);
  });

  it("从官员查到宫中侍君亲属", () => {
    expect(getPalaceRelativesOfOfficial(state, SHEN_HEAD)).toContain("shen_zhibai");
  });

  it("官员↔宫中亲属反向一致", () => {
    const consortId = getPalaceRelativesOfOfficial(state, SHEN_HEAD)[0]!;
    expect(getOfficialRelativesOfConsort(state, consortId).map((o) => o.id)).toContain(SHEN_HEAD);
  });

  it("无官员背景的侍君返回空结果而非报错", () => {
    expect(getOfficialRelativesOfConsort(state, "nobody_unlinked")).toEqual([]);
    expect(getFamilyByPersonId(state, "nobody_unlinked")).toBeUndefined();
  });

  it("getConsortsByFamilyId / getOfficialsByFamilyId 完整", () => {
    expect(getConsortsByFamilyId(state, SHEN_FAMILY)).toContain("shen_zhibai");
    expect(getOfficialsByFamilyId(state, SHEN_FAMILY).map((o) => o.id)).toContain(SHEN_HEAD);
  });
});

describe("kinship edges — integrity", () => {
  it("no person has two conflicting mothers", () => {
    const motherOf = new Map<string, string>();
    for (const k of state.kinship) {
      if (k.type !== "mother") continue;
      const prev = motherOf.get(k.fromPersonId);
      expect(prev === undefined || prev === k.toPersonId).toBe(true);
      motherOf.set(k.fromPersonId, k.toPersonId);
    }
  });

  it("no duplicate edges", () => {
    const seen = new Set<string>();
    for (const k of state.kinship) {
      const key = `${k.fromPersonId}|${k.toPersonId}|${k.type}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("mother edges have a reciprocal daughter/son edge", () => {
    const has = (from: string, to: string, type: string) =>
      state.kinship.some((k) => k.fromPersonId === from && k.toPersonId === to && k.type === type);
    for (const k of state.kinship) {
      if (k.type !== "mother") continue;
      const reciprocal = has(k.toPersonId, k.fromPersonId, "daughter") || has(k.toPersonId, k.fromPersonId, "son");
      expect(reciprocal).toBe(true);
    }
  });

  it("getCloseRelatives returns the head's children/spouse/mother edges", () => {
    const edges = getCloseRelatives(state, SHEN_HEAD);
    expect(edges.length).toBeGreaterThan(0);
    // 含一条把 shen_zhibai 视作子（son）的边。
    expect(edges.some((e) => e.toPersonId === "shen_zhibai" && e.type === "son")).toBe(true);
  });
});

describe("resolvePerson", () => {
  it("resolves officials (female), members, consorts (male)", () => {
    expect(resolvePerson(state, db, SHEN_HEAD)).toMatchObject({ kind: "official", sex: "female" });
    expect(resolvePerson(state, db, "shen_zhibai")).toMatchObject({ kind: "consort", sex: "male", familyId: SHEN_FAMILY });
    const memberId = Object.keys(state.familyMembers)[0]!;
    expect(resolvePerson(state, db, memberId)?.kind).toBe("member");
    expect(resolvePerson(state, db, "ghost")).toBeUndefined();
  });
});
