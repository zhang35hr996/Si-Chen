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
    expect(codes(s)).toContain("OFFICIAL_DUP_ID");
  });

  it("catches a dead official still seated", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    s.officials[seated.id] = { ...seated, status: "dead" };
    expect(codes(s)).toContain("OFFICIAL_DEAD_SEATED");
  });
});
