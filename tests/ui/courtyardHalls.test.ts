import { describe, it, expect } from "vitest";
import { hallsFor } from "../../src/ui/screens/CourtyardScreen";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("hallsFor", () => {
  it("设宫室居所给出 5 个殿（hallsFor 未排序，含全部 5 chamber）", () => {
    const state = createNewGameState(db);
    const halls = hallsFor(db, state, db.locations["jingren_gong"]!);
    expect(halls.map((h) => h.chamber).sort()).toEqual(
      ["east_annex", "east_side", "main", "west_annex", "west_side"].sort(),
    );
  });

  it("特殊宫（坤宁宫）只有主殿一个殿", () => {
    const state = createNewGameState(db);
    const halls = hallsFor(db, state, db.locations["kunninggong"]!);
    expect(halls.map((h) => h.chamber)).toEqual(["main"]);
  });
});
