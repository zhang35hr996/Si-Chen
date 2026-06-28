import { describe, expect, it } from "vitest";
import { getCharacterLocation, getPresentAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const baseState = createNewGameState(db);
// Inject lu_huaijin at zhongcui_gong for presence tests that need a specific consort.
const state = withConsort(baseState, db, "lu_huaijin");

describe("presence v0 (defaultLocation rule)", () => {
  it("places each slice character at their own location", () => {
    expect(getPresentAt(db, state, "kunninggong").map((c) => c.id)).toEqual(["shen_zhibai"]);
    expect(getPresentAt(db, state, "zhongcui_gong").map((c) => c.id)).toContain("lu_huaijin");
    expect(getPresentAt(db, state, "zichendian").map((c) => c.id).sort()).toEqual(["cheng_feng", "wei_sui"].sort());
  });

  it("returns [] for a location with no one and null for unknown characters", () => {
    expect(getCharacterLocation(db, state, "char_ghost")).toBeNull();
  });

  it("does not depend on where the player is", () => {
    const moved = { ...state, playerLocation: "yuhuayuan" };
    expect(getPresentAt(db, moved, "zichendian").map((c) => c.id).sort()).toEqual(["cheng_feng", "wei_sui"].sort());
  });
});

describe("presence: 搬迁 (standing.residence override)", () => {
  it("standing.residence overrides the authored defaultLocation", () => {
    const relocated = {
      ...state,
      standing: {
        ...state.standing,
        lu_huaijin: { ...state.standing.lu_huaijin!, residence: "chengqian_gong" },
      },
    };
    expect(getCharacterLocation(db, relocated, "lu_huaijin")).toBe("chengqian_gong");
    expect(getPresentAt(db, relocated, "chengqian_gong").map((c) => c.id)).toContain("lu_huaijin");
    // lu_huaijin left zhongcui_gong; a generated consort may still be there.
    expect(getPresentAt(db, relocated, "chengqian_gong").map((c) => c.id)).not.toContain("shen_zhibai");
  });

  it("ships the three new 侍君 palaces", () => {
    for (const id of ["chengqian_gong", "yongshou_gong", "yikun_gong"]) {
      expect(db.locations[id]).toBeDefined();
      expect(db.locations[id]!.zone).toBe("hougong");
    }
  });
});
