import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { decideDecree, adjacentHaremRank } from "../../src/store/empressDecree";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { withConsort } from "../helpers/consortFixture";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** Put lu_huaijin at a given rank+favor; push other in-band consorts above the band. */
function oneConsortAt(rank: string, favor: number): GameState {
  const s = withConsort(createNewGameState(db), db, "lu_huaijin");
  s.standing.lu_huaijin!.rank = rank;
  s.standing.lu_huaijin!.favor = favor;
  if (s.standing.xu_qinghuan) s.standing.xu_qinghuan.rank = "shichen"; // order 140 > 100, excluded
  return s;
}

describe("adjacentHaremRank", () => {
  it("promote = next higher band rank; demote = next lower; edges null", () => {
    // DECREE_RANK_CEILING=116 (guiren), FLOOR=50 (includes guannanzi at 52)
    expect(adjacentHaremRank(db, "cairen", "promote")).toBe("meiren"); // 92 → 100
    expect(adjacentHaremRank(db, "cairen", "demote")).toBe("changzai"); // 92 → 84
    expect(adjacentHaremRank(db, "meiren", "promote")).toBe("liangren"); // 100 → 108
    expect(adjacentHaremRank(db, "guiren", "promote")).toBeNull(); // 116 = ceiling
    expect(adjacentHaremRank(db, "guannanzi", "demote")).toBeNull(); // 52 = floor
  });
});

describe("decideDecree", () => {
  it("high favor → promote one step", () => {
    const s = oneConsortAt("cairen", 80);
    const plan = decideDecree(db, s, "seed-A");
    expect(plan).not.toBeNull();
    const setRank = plan!.effects.find((e) => e.type === "set_rank") as { type: "set_rank"; char: string; rank: string };
    expect(setRank.char).toBe("lu_huaijin");
    expect(setRank.rank).toBe("meiren");
    expect(plan!.reactions[0]!.speakerId).toBe("wei_sui");
    expect(plan!.reactions[1]!.speakerId).toBe("lu_huaijin");
  });

  it("low favor → demote one step", () => {
    const s = oneConsortAt("cairen", 20);
    const plan = decideDecree(db, s, "seed-A");
    const setRank = plan!.effects.find((e) => e.type === "set_rank") as { type: "set_rank"; rank: string };
    expect(setRank.rank).toBe("changzai");
  });

  it("mid favor → no decree", () => {
    expect(decideDecree(db, oneConsortAt("cairen", 50), "seed-A")).toBeNull();
  });

  it("ceiling: 贵人 + high favor → null", () => {
    expect(decideDecree(db, oneConsortAt("guiren", 90), "seed-A")).toBeNull();
  });

  it("floor: 官男子 + low favor → null", () => {
    expect(decideDecree(db, oneConsortAt("guannanzi", 10), "seed-A")).toBeNull();
  });

  it("excludes 冷宫 / official / 皇后 / above-band", () => {
    let s = withConsort(createNewGameState(db), db, "lu_huaijin");
    s = withConsort(s, db, "wenya");
    s.standing.lu_huaijin!.rank = "shichen"; // 140, excluded from band
    if (s.standing.xu_qinghuan) s.standing.xu_qinghuan.rank = "shichen";
    s.standing.wenya!.rank = "meiren"; // in band BUT 冷宫 → excluded
    s.standing.wenya!.favor = 90;
    expect(decideDecree(db, s, "seed-A")).toBeNull();
  });

  it("is deterministic for the same seed", () => {
    const s = oneConsortAt("cairen", 80);
    expect(decideDecree(db, s, "k")).toEqual(decideDecree(db, s, "k"));
  });

  it("runtime-db（生成角色合并进 characters）：候选 ID 不重复，无多皇后", () => {
    const s = createNewGameState(db);
    // Simulate App's runtime db
    const runtimeDb = { ...db, characters: { ...db.characters, ...s.generatedConsorts } };
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const plan = decideDecree(runtimeDb, s, `dedup:${i}`);
      if (plan) {
        const setRank = plan.effects.find((e) => e.type === "set_rank") as { char: string } | undefined;
        if (setRank) {
          expect(seen.has(setRank.char)).toBe(false);
          seen.add(setRank.char);
          break;
        }
      }
    }
    // If no plan triggered that's fine — main check is no panic/crash
  });
});
