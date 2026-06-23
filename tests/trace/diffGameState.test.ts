import { describe, expect, it } from "vitest";
import { diffGameState } from "../../src/engine/trace/diff";
import { createGameStore } from "../../src/store/gameStore";
import { applyEffects } from "../../src/engine/effects/funnel";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const makeStarted = () => {
  const store = createGameStore();
  store.newGame(db);
  return store.getState();
};

describe("diffGameState", () => {
  it("returns empty array when before === after (same reference)", () => {
    const state = makeStarted();
    const diffs = diffGameState(state, state);
    expect(diffs).toHaveLength(0);
  });

  it("detects favor change in standing", () => {
    const before = makeStarted();
    const firstChar = Object.keys(before.standing)[0]!;
    const result = applyEffects(db, before, [{ type: "favor", char: firstChar, delta: 5 }]);
    expect(result.ok).toBe(true);
    const after = result.value;
    const diffs = diffGameState(before, after);
    const favorDiff = diffs.find((d) => d.path === `standing.${firstChar}.favor`);
    expect(favorDiff).toBeDefined();
    expect(favorDiff?.after).toBe((before.standing[firstChar]?.favor ?? 0) + 5);
  });

  it("detects calendar AP change", () => {
    const store = createGameStore();
    store.newGame(db);
    const before = store.getState();
    store.dispatch({ type: "SPEND_AP", amount: 1 });
    const after = store.getState();
    const diffs = diffGameState(before, after);
    const apDiff = diffs.find((d) => d.path === "calendar.ap");
    expect(apDiff).toBeDefined();
    expect(apDiff?.before).toBe(6);
    expect(apDiff?.after).toBe(5);
  });

  it("detects flag changes", () => {
    const before = makeStarted();
    const result = applyEffects(db, before, [{ type: "flag", key: "test_flag", value: 1 }]);
    expect(result.ok).toBe(true);
    const diffs = diffGameState(before, result.value);
    const flagDiff = diffs.find((d) => d.path === "flags.test_flag");
    expect(flagDiff).toBeDefined();
    expect(flagDiff?.before).toBeUndefined();
    expect(flagDiff?.after).toBe(1);
  });

  it("detects resource sovereign changes", () => {
    const before = makeStarted();
    const result = applyEffects(db, before, [{ type: "resource", pillar: "sovereign", field: "prestige", delta: 3 }]);
    expect(result.ok).toBe(true);
    const diffs = diffGameState(before, result.value);
    const diff = diffs.find((d) => d.path === "resources.sovereign.prestige");
    expect(diff).toBeDefined();
  });
});
