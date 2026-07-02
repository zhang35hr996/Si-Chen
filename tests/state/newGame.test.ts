import { describe, expect, it } from "vitest";
import { formatAp, formatGameTime } from "../../src/engine/calendar/time";
import { createNewGameState, memoryEntryId } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("createNewGameState", () => {
  const state = createNewGameState(db);

  it("starts at 元年一月上旬 / 6 AP at the world's starting location", () => {
    expect(formatGameTime(state.calendar)).toBe("元年一月上旬");
    expect(formatAp(state.calendar)).toBe("行动点：5/5");
    expect(state.playerLocation).toBe("zichendian");
  });

  it("copies starting resources from world.json (bloodline gains empty heirs)", () => {
    expect(state.resources.sovereign).toEqual({ health: 70, healthStatus: "healthy", diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 });
    expect(state.resources.nation).toEqual({ military: 50, treasury: 10000, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10, borderPressure: 35 });
    expect(state.resources.bloodline).toEqual({
      menstrualStatus: "normal",
      pregnancy: { status: "none", candidateIds: [] },
      gestations: [],
      heirs: [],
    });
  });

  it("seeds standing for characters with an initial standing", () => {
    // shen_zhibai is now event_only; empress is randomly generated
    expect(state.standing["shen_zhibai"]).toBeUndefined();
    expect(state.standing["wei_sui"]).toEqual({ rank: "sili_zhang", favor: 40, peakFavor: 40 });
    expect(state.standing["taihou"]).toBeUndefined();
    // A generated empress should be present
    const empressEntries = Object.entries(state.standing).filter(([, st]) => st.rank === "huanghou");
    expect(empressEntries).toHaveLength(1);
    expect(empressEntries[0]![0]).toMatch(/^generated_empress_/);
  });

  // Story consorts were removed from content; wei_sui is a remaining authored character
  // with an authored initial memory, exercising the same seeding path.
  it("seeds authored initial memories: monotonic ids, ownerId, new fields", () => {
    const store = state.memories["wei_sui"];
    expect(store).toBeDefined();
    expect(store!.entries).toHaveLength(1);
    const entry = store!.entries[0]!;
    expect(entry.id).toBe(memoryEntryId("wei_sui", 1));
    expect(entry.id).toBe("mem_wei_sui_000001");
    expect(entry.ownerId).toBe("wei_sui");
    expect(entry.strength).toBe(60);
    expect(entry.retention).toBe("permanent");
    expect(entry.triggerTags).toEqual(["rite", "duty"]);
    expect(entry.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(store!.nextSeq).toBe(2);
  });

  it("is deterministic and does not alias content arrays", () => {
    const a = createNewGameState(db);
    const b = createNewGameState(db);
    expect(a).toEqual(b);
    a.memories["wei_sui"]!.entries[0]!.triggerTags.push("mutated");
    expect(db.characters["wei_sui"]!.initialMemories[0]!.triggerTags).not.toContain("mutated");
  });
});
