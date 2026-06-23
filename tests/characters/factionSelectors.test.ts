import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { getHaremFactionId, sameHaremFaction } from "../../src/engine/characters/factionSelectors";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function makeState() {
  return createNewGameState(db);
}

function firstTwoConsortIds(state: ReturnType<typeof makeState>): [string, string] | null {
  const ids = Object.keys(state.standing).filter((id) => db.characters[id]?.kind === "consort");
  if (ids.length < 2) return null;
  return [ids[0]!, ids[1]!];
}

describe("getHaremFactionId", () => {
  it("returns undefined when no haremFactionId set", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    expect(getHaremFactionId(state, ids[0])).toBeUndefined();
  });

  it("returns set haremFactionId", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    const patched = {
      ...state,
      standing: {
        ...state.standing,
        [ids[0]]: { ...state.standing[ids[0]]!, haremFactionId: "faction_phoenix" },
      },
    };
    expect(getHaremFactionId(patched, ids[0])).toBe("faction_phoenix");
  });

  it("returns undefined for char with no standing entry", () => {
    const state = makeState();
    expect(getHaremFactionId(state, "char_ghost_99")).toBeUndefined();
  });
});

describe("sameHaremFaction", () => {
  it("two consorts with no faction → false", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    expect(sameHaremFaction(state, ids[0], ids[1])).toBe(false);
  });

  it("two consorts with same faction → true", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    const patched = {
      ...state,
      standing: {
        ...state.standing,
        [ids[0]]: { ...state.standing[ids[0]]!, haremFactionId: "faction_phoenix" },
        [ids[1]]: { ...state.standing[ids[1]]!, haremFactionId: "faction_phoenix" },
      },
    };
    expect(sameHaremFaction(patched, ids[0], ids[1])).toBe(true);
  });

  it("two consorts with different factions → false", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    const patched = {
      ...state,
      standing: {
        ...state.standing,
        [ids[0]]: { ...state.standing[ids[0]]!, haremFactionId: "faction_phoenix" },
        [ids[1]]: { ...state.standing[ids[1]]!, haremFactionId: "faction_lotus" },
      },
    };
    expect(sameHaremFaction(patched, ids[0], ids[1])).toBe(false);
  });

  it("one consort has faction, other doesn't → false", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    const patched = {
      ...state,
      standing: {
        ...state.standing,
        [ids[0]]: { ...state.standing[ids[0]]!, haremFactionId: "faction_phoenix" },
      },
    };
    expect(sameHaremFaction(patched, ids[0], ids[1])).toBe(false);
  });

  it("faction stored only in standing (not content) — no content mutation", () => {
    const state = makeState();
    const ids = firstTwoConsortIds(state);
    if (!ids) return;
    const char = db.characters[ids[0]];
    // haremFactionId should not exist on CharacterContent
    expect((char as Record<string, unknown>)["haremFactionId"]).toBeUndefined();
  });
});
