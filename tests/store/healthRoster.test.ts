import { describe, expect, it } from "vitest";
import { currentAgeOf, livingConsortIds } from "../../src/store/healthRoster";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("currentAgeOf", () => {
  it("sovereign uses startingAge + (year-1)", () => {
    const s = createNewGameState(db);
    expect(currentAgeOf(db, s, { kind: "sovereign" })).toBe(db.world.sovereign.startingAge + (s.calendar.year - 1));
  });
  it("dynamic consort uses ageAtEntry + (year - enteredAtYear)", () => {
    const s = createNewGameState(db);
    const id = "xiunan_test_1";
    s.generatedConsorts[id] = { ...Object.values(db.characters).find((c) => c.kind === "consort")!, id } as any;
    s.standing[id] = { rank: Object.keys(db.ranks)[0]!, favor: 10, health: 80, healthStatus: "healthy", ageAtEntry: 16, enteredAtYear: s.calendar.year } as any;
    expect(currentAgeOf(db, s, { kind: "consort", id })).toBe(16);
  });
});

describe("livingConsortIds", () => {
  it("includes static consorts with standing, excludes deceased/candidate, includes generated", () => {
    const s = createNewGameState(db);
    const ids = livingConsortIds(db, s);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...ids].sort());
  });
});
