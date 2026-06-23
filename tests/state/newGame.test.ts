import { describe, expect, it } from "vitest";
import { formatAp, formatGameTime } from "../../src/engine/calendar/time";
import { createNewGameState, memoryEntryId } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("createNewGameState", () => {
  const state = createNewGameState(db);

  it("starts at 元年一月上旬 / 6 AP at the world's starting location", () => {
    expect(formatGameTime(state.calendar)).toBe("元年一月上旬");
    expect(formatAp(state.calendar)).toBe("行动点：6/6");
    expect(state.playerLocation).toBe("zichendian");
  });

  it("copies starting resources from world.json (bloodline gains empty heirs)", () => {
    expect(state.resources.sovereign).toEqual({ health: 70, healthStatus: "healthy", diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 });
    expect(state.resources.nation).toEqual({ military: 50, treasury: 10000, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10 });
    expect(state.resources.bloodline).toEqual({
      menstrualStatus: "normal",
      pregnancy: { status: "none", candidateIds: [] },
      gestations: [],
      heirs: [],
    });
  });

  it("seeds standing for characters with an initial standing", () => {
    expect(state.standing["shen_zhibai"]).toEqual({ rank: "fenghou", favor: 25, affection: 50, palaceEnteredAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, health: 78, healthStatus: "healthy", birthFamilyId: "fam_0002" });
    expect(state.standing["wei_sui"]).toEqual({ rank: "sili_zhang", favor: 40 });
    expect(state.standing["taihou"]).toBeUndefined();
  });

  it("seeds authored initial memories: monotonic ids, ownerId, new fields", () => {
    const store = state.memories["lu_huaijin"];
    expect(store).toBeDefined();
    expect(store!.entries).toHaveLength(1);
    const entry = store!.entries[0]!;
    expect(entry.id).toBe(memoryEntryId("lu_huaijin", 1));
    expect(entry.id).toBe("mem_lu_huaijin_000001");
    expect(entry.ownerId).toBe("lu_huaijin");
    expect(entry.strength).toBe(70);
    expect(entry.retention).toBe("permanent");
    expect(entry.triggerTags).toEqual(["neglect"]);
    expect(entry.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(store!.nextSeq).toBe(2);
  });

  it("is deterministic and does not alias content arrays", () => {
    const a = createNewGameState(db);
    const b = createNewGameState(db);
    expect(a).toEqual(b);
    a.memories["lu_huaijin"]!.entries[0]!.triggerTags.push("mutated");
    expect(db.characters["lu_huaijin"]!.initialMemories[0]!.triggerTags).not.toContain("mutated");
  });
});
