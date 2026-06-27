import { describe, it, expect } from "vitest";
import { hallsFor, MAX_CHUXIU_ROOMS } from "../../src/ui/screens/CourtyardScreen";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { ContentDB } from "../../src/engine/content/loader";
import type { CharacterContent } from "../../src/engine/content/schemas";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function withChuxiuResidents(count: number): { db: ContentDB; state: ReturnType<typeof createNewGameState> } {
  const template = db.characters["lu_huaijin"]!;
  const residents = Array.from({ length: count }, (_, index): CharacterContent => ({
    ...template,
    id: `chuxiu_test_${index + 1}`,
    profile: {
      ...template.profile,
      name: `秀男${index + 1}`,
    },
    defaultLocation: "chuxiu_gong",
  }));
  const testDb: ContentDB = {
    ...db,
    characters: {
      ...db.characters,
      ...Object.fromEntries(residents.map((resident) => [resident.id, resident])),
    },
  };
  return { db: testDb, state: createNewGameState(testDb) };
}

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

  it("储秀宫保留第一人主殿，并按后续人数动态显示厢房", () => {
    const fixture = withChuxiuResidents(3);
    const halls = hallsFor(fixture.db, fixture.state, fixture.db.locations["chuxiu_gong"]!);

    expect(halls).toHaveLength(3);
    expect(halls.map((hall) => hall.name)).toEqual(["主殿", "厢房一", "厢房二"]);
    expect(halls.map((hall) => hall.occupant?.profile.name)).toEqual(["秀男1", "秀男2", "秀男3"]);
    expect(halls.every((hall) => hall.occupant !== undefined)).toBe(true);
  });

  it("储秀宫无住客时只保留空主殿，不虚构厢房", () => {
    const state = createNewGameState(db);
    const halls = hallsFor(db, state, db.locations["chuxiu_gong"]!);
    expect(halls).toHaveLength(1);
    expect(halls[0]).toMatchObject({ chamber: "main", name: "主殿", occupant: undefined });
  });

  it("储秀宫最多增加三十间厢房", () => {
    const fixture = withChuxiuResidents(MAX_CHUXIU_ROOMS + 5);
    const halls = hallsFor(fixture.db, fixture.state, fixture.db.locations["chuxiu_gong"]!);

    expect(halls).toHaveLength(MAX_CHUXIU_ROOMS + 1); // 主殿 + 厢房一至三十
    expect(halls[0]?.name).toBe("主殿");
    expect(halls[1]?.name).toBe("厢房一");
    expect(halls.at(-1)?.name).toBe("厢房三十");
  });
});
