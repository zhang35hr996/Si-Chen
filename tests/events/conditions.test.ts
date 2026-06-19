import { describe, expect, it } from "vitest";
import type { TriggerCondition } from "../../src/engine/content/schemas";
import { evaluateCondition, isFlagSet } from "../../src/engine/events/conditions";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const base = (): GameState => {
  const s = createNewGameState(db); // at yushufang, 元年一月上旬
  return {
    ...s,
    flags: { rite_scheduled: true, count: 3, label: "x", off: false },
    eventLog: [{ eventId: "ev_menses_rite", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
  };
};

const ev = (c: TriggerCondition, state = base()) => evaluateCondition(c, { db, state });

describe("predicate truth table", () => {
  it.each<[string, TriggerCondition, boolean]>([
    ["flagSet true", { flagSet: "rite_scheduled" }, true],
    ["flagSet number counts as set", { flagSet: "count" }, true],
    ["flagSet string counts as set", { flagSet: "label" }, true],
    ["flagSet false is NOT set", { flagSet: "off" }, false],
    ["flagSet absent", { flagSet: "ghost" }, false],
    ["monthAtLeast met", { monthAtLeast: 1 }, true],
    ["monthAtLeast unmet", { monthAtLeast: 3 }, false],
    ["periodIs met", { periodIs: "early" }, true],
    ["periodIs unmet", { periodIs: "late" }, false],
    ["atLocation met", { atLocation: "zichendian" }, true],
    ["atLocation unmet", { atLocation: "yuhuayuan" }, false],
    ["relationshipAtLeast met (sili trust 50)", { relationshipAtLeast: { char: "wei_sui", field: "trust", value: 50 } }, true],
    ["relationshipAtLeast unmet", { relationshipAtLeast: { char: "wei_sui", field: "trust", value: 51 } }, false],
    ["relationship affinity axis", { relationshipAtLeast: { char: "lu_huaijin", field: "affinity", value: 45 } }, true],
    ["relationship unknown char → 0", { relationshipAtLeast: { char: "char_ghost", field: "trust", value: 1 } }, false],
    ["favorAtLeast met (sili 40)", { favorAtLeast: { char: "wei_sui", value: 40 } }, true],
    ["favorAtLeast unmet", { favorAtLeast: { char: "wei_sui", value: 41 } }, false],
    ["rankAtLeast: 凤后(100) ≥ 承徽(60)", { rankAtLeast: { char: "shen_zhibai", rank: "chenghui" } }, true],
    ["rankAtLeast: 承徽(60) < 凤后(100)", { rankAtLeast: { char: "lu_huaijin", rank: "fenghou" } }, false],
    ["rankAtLeast equal rank", { rankAtLeast: { char: "lu_huaijin", rank: "chenghui" } }, true],
    ["rankAtLeast unknown rank", { rankAtLeast: { char: "shen_zhibai", rank: "rank_ghost" } }, false],
    ["hasMemoryTag met (沈承徽 neglect)", { hasMemoryTag: { char: "lu_huaijin", tag: "neglect" } }, true],
    ["hasMemoryTag wrong tag", { hasMemoryTag: { char: "lu_huaijin", tag: "favor" } }, false],
    ["hasMemoryTag unknown char → false", { hasMemoryTag: { char: "char_ghost", tag: "neglect" } }, false],
    ["eventFired met", { eventFired: "ev_menses_rite" }, true],
    ["eventFired unmet", { eventFired: "ev_shen_neglect" }, false],
  ])("%s", (_name, condition, expected) => {
    expect(ev(condition)).toBe(expected);
  });

  it("nesting: all / any / not compose", () => {
    expect(ev({ all: [{ flagSet: "rite_scheduled" }, { atLocation: "zichendian" }] })).toBe(true);
    expect(ev({ all: [{ flagSet: "rite_scheduled" }, { atLocation: "yuhuayuan" }] })).toBe(false);
    expect(ev({ any: [{ atLocation: "yuhuayuan" }, { periodIs: "early" }] })).toBe(true);
    expect(ev({ not: { eventFired: "ev_shen_neglect" } })).toBe(true);
    expect(
      ev({ all: [{ any: [{ flagSet: "off" }, { monthAtLeast: 1 }] }, { not: { flagSet: "ghost" } }] }),
    ).toBe(true);
  });

  it("isFlagSet semantics documented: present-and-not-false", () => {
    const state = base();
    expect(isFlagSet(state, "off")).toBe(false);
    expect(isFlagSet(state, "count")).toBe(true);
  });
});
