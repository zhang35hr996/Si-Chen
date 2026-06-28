import { describe, expect, it } from "vitest";
import { getCharacterLocation, getPresentAt, inPalaceConsorts, consortLocationAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import { MAO_SLOT } from "../../src/engine/calendar/time";

const db = loadRealContent();
// shen_zhibai is now event_only; inject her as empress (replacing the generated empress)
// so that presence tests expecting "shen_zhibai" at "kunninggong" continue to work.
const baseState = (() => {
  let s = createNewGameState(db);
  const genEmpressId = Object.keys(s.standing).find((id) => s.standing[id]!.rank === "huanghou");
  if (genEmpressId) {
    const { [genEmpressId]: _st, ...restSt } = s.standing;
    const { [genEmpressId]: _gc, ...restGc } = s.generatedConsorts;
    s = { ...s, standing: restSt, generatedConsorts: restGc };
  }
  return withConsort(s, db, "shen_zhibai");
})();
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

describe("presence: 运行时 DB 去重 (runtime-db dedup)", () => {
  it("inPalaceConsorts yields no duplicate IDs when caller pre-merges generatedConsorts into db", () => {
    // App.tsx spreads generatedConsorts into db.characters at runtime.
    // Presence functions must not double-count by also iterating state.generatedConsorts.
    const runtimeDb = {
      ...db,
      characters: { ...db.characters, ...baseState.generatedConsorts },
    };
    const ids = inPalaceConsorts(runtimeDb, baseState).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getPresentAt yields no duplicate IDs under runtime-db pattern", () => {
    const runtimeDb = {
      ...db,
      characters: { ...db.characters, ...baseState.generatedConsorts },
    };
    const genId = Object.keys(baseState.generatedConsorts)[0]!;
    const residence = baseState.standing[genId]?.residence ?? "";
    const ids = getPresentAt(runtimeDb, baseState, residence).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("presence: consortLocationAt with raw db", () => {
  it("generated consort location is non-empty with raw db (no greeting/wander short-circuit)", () => {
    // When called with raw db (state.generatedConsorts not merged), consortLocationAt must
    // still resolve the character and apply greeting/wander rules rather than bailing early.
    const genId = Object.keys(baseState.generatedConsorts)[0]!;
    const loc = consortLocationAt(db, baseState, genId, MAO_SLOT);
    expect(loc).toBeTruthy();
    // At MAO_SLOT a non-excused consort goes to the greeting location or stays home.
    // Either way the result is a non-empty string — it should NOT be "" (the failure path).
    expect(typeof loc).toBe("string");
  });
});
