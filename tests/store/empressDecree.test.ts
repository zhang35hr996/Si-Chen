import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { decideDecree, adjacentHaremRank } from "../../src/store/empressDecree";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** Put lu_huaijin at a given rank+favor; push other in-band consorts above the band. */
function oneConsortAt(rank: string, favor: number): GameState {
  const s = createNewGameState(db);
  s.standing.lu_huaijin!.rank = rank;
  s.standing.lu_huaijin!.favor = favor;
  if (s.standing.xu_qinghuan) s.standing.xu_qinghuan.rank = "shichen"; // order 110 > 100, excluded
  return s;
}

describe("adjacentHaremRank", () => {
  it("promote = next higher band rank; demote = next lower; edges null", () => {
    expect(adjacentHaremRank(db, "meiren", "promote")).toBe("guiren"); // 90 → 100
    expect(adjacentHaremRank(db, "meiren", "demote")).toBe("cairen"); // 90 → 80
    expect(adjacentHaremRank(db, "guiren", "promote")).toBeNull(); // 100 ceiling
    expect(adjacentHaremRank(db, "guannanzi", "demote")).toBeNull(); // 40 floor
  });
});

describe("decideDecree", () => {
  it("high favor → promote one step", () => {
    const s = oneConsortAt("meiren", 80);
    const plan = decideDecree(db, s, "seed-A");
    expect(plan).not.toBeNull();
    const setRank = plan!.effects.find((e) => e.type === "set_rank") as { type: "set_rank"; char: string; rank: string };
    expect(setRank.char).toBe("lu_huaijin");
    expect(setRank.rank).toBe("guiren");
    expect(plan!.reactions[0]!.speakerId).toBe("wei_sui");
    expect(plan!.reactions[1]!.speakerId).toBe("lu_huaijin");
  });

  it("low favor → demote one step", () => {
    const s = oneConsortAt("meiren", 20);
    const plan = decideDecree(db, s, "seed-A");
    const setRank = plan!.effects.find((e) => e.type === "set_rank") as { type: "set_rank"; rank: string };
    expect(setRank.rank).toBe("cairen");
  });

  it("mid favor → no decree", () => {
    expect(decideDecree(db, oneConsortAt("meiren", 50), "seed-A")).toBeNull();
  });

  it("ceiling: 贵人 + high favor → null", () => {
    expect(decideDecree(db, oneConsortAt("guiren", 90), "seed-A")).toBeNull();
  });

  it("floor: 官男子 + low favor → null", () => {
    expect(decideDecree(db, oneConsortAt("guannanzi", 10), "seed-A")).toBeNull();
  });

  it("excludes 冷宫 / official / 凤后 / above-贵人", () => {
    const s = createNewGameState(db);
    s.standing.lu_huaijin!.rank = "shichen"; // 110, excluded
    if (s.standing.xu_qinghuan) s.standing.xu_qinghuan.rank = "shichen";
    s.standing.wenya!.rank = "meiren"; // in band BUT 冷宫 → excluded
    s.standing.wenya!.favor = 90;
    expect(decideDecree(db, s, "seed-A")).toBeNull();
  });

  it("is deterministic for the same seed", () => {
    const s = oneConsortAt("meiren", 80);
    expect(decideDecree(db, s, "k")).toEqual(decideDecree(db, s, "k"));
  });
});
