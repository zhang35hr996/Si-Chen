import { describe, expect, it } from "vitest";
import { currentAgeOf, livingConsortIds } from "../../src/store/healthRoster";
import { createNewGameState } from "../../src/engine/state/newGame";
import { legacyConsortContent } from "../helpers/consortFixture";
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
    s.generatedConsorts[id] = { ...legacyConsortContent("lu_huaijin"), id } as any;
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

  it("includes a generated (选秀) consort", () => {
    const s = createNewGameState(db);
    const base = legacyConsortContent("lu_huaijin");
    const id = "gen_test_1";
    s.generatedConsorts[id] = { ...base, id } as any;
    s.standing[id] = { rank: Object.keys(db.ranks)[0]!, favor: 0, health: 100, healthStatus: "healthy" } as any;
    expect(livingConsortIds(db, s)).toContain(id);
  });

  it("excludes deceased and candidate consorts", () => {
    const s = createNewGameState(db);
    const base = legacyConsortContent("lu_huaijin");
    s.generatedConsorts["consort_dead"] = { ...base, id: "consort_dead" } as any;
    s.standing["consort_dead"] = { rank: Object.keys(db.ranks)[0]!, favor: 0, lifecycle: "deceased" } as any;
    s.generatedConsorts["consort_cand"] = { ...base, id: "consort_cand" } as any;
    s.standing["consort_cand"] = { rank: Object.keys(db.ranks)[0]!, favor: 0, lifecycle: "candidate" } as any;
    const ids = livingConsortIds(db, s);
    expect(ids).not.toContain("consort_dead");
    expect(ids).not.toContain("consort_cand");
  });
});

describe("currentAgeOf — throw on missing subject", () => {
  it("currentAgeOf throws on a missing consort (no silent fallback)", () => {
    const s = createNewGameState(db);
    expect(() => currentAgeOf(db, s, { kind: "consort", id: "does_not_exist" })).toThrow();
  });
  it("currentAgeOf throws on a missing heir", () => {
    const s = createNewGameState(db);
    expect(() => currentAgeOf(db, s, { kind: "heir", id: "no_such_heir" })).toThrow();
  });
});
