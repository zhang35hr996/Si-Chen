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
    expect(state.playerLocation).toBe("yushufang");
  });

  it("copies starting resources from world.json (bloodline gains empty heirs)", () => {
    expect(state.resources.court).toEqual({ authority: 50, publicSupport: 50, factionPressure: 20 });
    expect(state.resources.harem).toEqual({ harmony: 60, jealousy: 20 });
    expect(state.resources.bloodline).toEqual({
      legitimacy: 60,
      menstrualStatus: "normal",
      pregnancy: { status: "none", candidateIds: [] },
      gestations: [],
      heirs: [],
    });
  });

  it("seeds relationship + standing for every character", () => {
    expect(Object.keys(state.relationships).sort()).toEqual(
      ["chu_jun", "feng_hou", "shen_chenghui", "sili_nvguan", "taihou", "wenya_shijun"],
    );
    expect(state.relationships["shen_chenghui"]).toEqual({ trust: 25, affinity: 45, flags: [] });
    expect(state.standing["feng_hou"]).toEqual({ rank: "fenghou", favor: 25 });
    expect(state.standing["sili_nvguan"]).toEqual({ rank: "sili_zhang", favor: 40 });
    expect(state.standing["taihou"]).toBeUndefined();
  });

  it("seeds authored initial memories: monotonic ids, authored source, protected", () => {
    const store = state.memories["shen_chenghui"];
    expect(store).toBeDefined();
    expect(store!.entries).toHaveLength(1);
    const entry = store!.entries[0]!;
    expect(entry.id).toBe(memoryEntryId("shen_chenghui", 1));
    expect(entry.id).toBe("mem_shen_chenghui_000001");
    expect(entry.source).toBe("authored"); // 既有背景记忆 — protected allowed
    expect(entry.protected).toBe(true);
    expect(entry.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(store!.nextSeq).toBe(2);
  });

  it("is deterministic and does not alias content arrays", () => {
    const a = createNewGameState(db);
    const b = createNewGameState(db);
    expect(a).toEqual(b);
    a.relationships["feng_hou"]!.flags.push("mutated");
    expect(db.characters["feng_hou"]!.initialRelationship.flags).toEqual([]);
  });
});
