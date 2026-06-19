import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { inPalaceConsorts } from "../../src/engine/characters/presence";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("inPalaceConsorts", () => {
  it("returns only consorts, excluding officials", () => {
    const list = inPalaceConsorts(db, createNewGameState(db));
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.kind === "consort")).toBe(true);
  });

  it("excludes 冷宫 consorts (defaultLocation lenggong)", () => {
    const list = inPalaceConsorts(db, createNewGameState(db));
    expect(list.every((c) => c.defaultLocation !== "changmengong")).toBe(true);
  });

  it("excludes deceased consorts", () => {
    const s = createNewGameState(db);
    const victim = inPalaceConsorts(db, s)[0]!;
    s.standing[victim.id] = { ...s.standing[victim.id]!, lifecycle: "deceased" };
    expect(inPalaceConsorts(db, s).some((c) => c.id === victim.id)).toBe(false);
  });

  it("sorts by effective precedence, highest first", () => {
    const list = inPalaceConsorts(db, createNewGameState(db));
    const s = createNewGameState(db);
    const orders = list.map((c) => {
      const st = s.standing[c.id]!;
      return db.ranks[st.rank]!.order + (st.title !== undefined ? 1 : 0);
    });
    const sorted = [...orders].sort((a, b) => b - a);
    expect(orders).toEqual(sorted);
  });
});
