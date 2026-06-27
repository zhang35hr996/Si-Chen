import { describe, it, expect } from "vitest";
import { hallsFor } from "../../src/ui/screens/CourtyardScreen";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { CharacterContent } from "../../src/engine/content/schemas";
import type { GameState } from "../../src/engine/state/types";

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

  it("储秀宫无人时只有空主殿", () => {
    const state = createNewGameState(db);
    const chuxiu = db.locations["chuxiu_gong"];
    if (!chuxiu) return; // 跳过若 content 中无此地点
    const halls = hallsFor(db, state, chuxiu);
    expect(halls).toHaveLength(1);
    expect(halls[0]!.chamber).toBe("main");
    expect(halls[0]!.occupant).toBeUndefined();
  });

  it("储秀宫有多人时动态生成厢房", () => {
    const chuxiu = db.locations["chuxiu_gong"];
    if (!chuxiu) return;
    // 注入 3 名候选侍君到储秀宫
    const fakeConsorts = Array.from({ length: 3 }, (_, i) => ({
      id: `candidate_${i}`,
      kind: "consort" as const,
      portraitSet: "consort1",
      defaultLocation: "chuxiu_gong",
      profile: { name: `候选${i + 1}` },
    })) as unknown as CharacterContent[];
    const state: GameState = {
      ...createNewGameState(db),
      generatedConsorts: Object.fromEntries(
        fakeConsorts.map((c) => [c.id, { defaultLocation: "chuxiu_gong" }]),
      ),
      standing: {
        ...createNewGameState(db).standing,
        ...Object.fromEntries(fakeConsorts.map((c) => [c.id, {
          rank: "gengyi", lifecycle: "normal" as const,
          health: 100, healthStatus: "healthy" as const,
        }])),
      },
    } as unknown as GameState;

    const dbWithCandidates = {
      ...db,
      characters: {
        ...db.characters,
        ...Object.fromEntries(fakeConsorts.map((c) => [c.id, c])),
      },
    };

    const halls = hallsFor(dbWithCandidates, state, chuxiu);
    expect(halls).toHaveLength(3);
    expect(halls[0]!.chamber).toBe("main");
    expect(halls[0]!.name).toBe("主殿");
    expect(halls[1]!.chamber).toBe("side_1");
    expect(halls[1]!.name).toBe("厢房一");
    expect(halls[2]!.chamber).toBe("side_2");
    expect(halls[2]!.name).toBe("厢房二");
  });
});
