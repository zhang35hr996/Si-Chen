import { describe, expect, it } from "vitest";
import { getCharacterLocation, getPresentAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);

describe("presence v0 (defaultLocation rule)", () => {
  it("places each slice character at their own location", () => {
    expect(getPresentAt(db, state, "hougong_zhudian").map((c) => c.id)).toEqual(["feng_hou"]);
    expect(getPresentAt(db, state, "yuhuayuan").map((c) => c.id)).toEqual(["shen_chenghui"]);
    expect(getPresentAt(db, state, "yushufang").map((c) => c.id)).toEqual(["sili_nvguan"]);
  });

  it("returns [] for a location with no one and null for unknown characters", () => {
    expect(getPresentAt(db, state, "loc_ghost")).toEqual([]);
    expect(getCharacterLocation(db, state, "char_ghost")).toBeNull();
  });

  it("does not depend on where the player is", () => {
    const moved = { ...state, playerLocation: "yuhuayuan" };
    expect(getPresentAt(db, moved, "yushufang").map((c) => c.id)).toEqual(["sili_nvguan"]);
  });
});
