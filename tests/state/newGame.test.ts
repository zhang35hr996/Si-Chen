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
    expect(state.resources.sovereign).toEqual({ health: 70, diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 });
    expect(state.resources.nation).toEqual({ military: 50, treasury: 50, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10 });
    expect(state.resources.bloodline).toEqual({
      menstrualStatus: "normal",
      pregnancy: { status: "none", candidateIds: [] },
      gestations: [],
      heirs: [],
    });
  });

  it("seeds relationship + standing for every character", () => {
    expect(Object.keys(state.relationships).sort()).toEqual(
      ["xu_qinghuan", "shen_zhibai", "lu_huaijin", "wei_sui", "taihou", "wenya", "cheng_feng"].sort(),
    );
    expect(state.relationships["lu_huaijin"]).toEqual({ trust: 25, affinity: 45, flags: [] });
    expect(state.standing["shen_zhibai"]).toEqual({ rank: "fenghou", favor: 25 });
    expect(state.standing["wei_sui"]).toEqual({ rank: "sili_zhang", favor: 40 });
    expect(state.standing["taihou"]).toBeUndefined();
  });

  it("seeds authored initial memories: monotonic ids, authored source, protected", () => {
    const store = state.memories["lu_huaijin"];
    expect(store).toBeDefined();
    expect(store!.entries).toHaveLength(1);
    const entry = store!.entries[0]!;
    expect(entry.id).toBe(memoryEntryId("lu_huaijin", 1));
    expect(entry.id).toBe("mem_lu_huaijin_000001");
    expect(entry.source).toBe("authored"); // 既有背景记忆 — protected allowed
    expect(entry.protected).toBe(true);
    expect(entry.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(store!.nextSeq).toBe(2);
  });

  it("is deterministic and does not alias content arrays", () => {
    const a = createNewGameState(db);
    const b = createNewGameState(db);
    expect(a).toEqual(b);
    a.relationships["shen_zhibai"]!.flags.push("mutated");
    expect(db.characters["shen_zhibai"]!.initialRelationship.flags).toEqual([]);
  });
});
