import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import { gestationConfig, buildBirth, plannedBirth, birthDue } from "../../src/store/gestation";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function sovereignCarrying(month: number): GameState {
  const s = createNewGameState(db);
  const conceivedAt = makeGameTime(1, month, "early");
  s.resources.bloodline.pregnancy = { status: "carrying", conceivedAt, candidateIds: [] };
  s.resources.bloodline.gestations = [{ carrier: "sovereign", conceivedAt }];
  return s;
}

describe("gestationConfig", () => {
  it("reads world.gestation", () => {
    expect(gestationConfig(db).termMonths).toBe(10);
  });
});

describe("plannedBirth", () => {
  it("sovereign births at 孕十月", () => {
    const s = sovereignCarrying(1);
    expect(plannedBirth(db, s)!.birthMonthOrdinal).toBe(monthOrdinal(makeGameTime(1, 10, "early")));
  });
  it("returns null with no gestation", () => {
    expect(plannedBirth(db, createNewGameState(db))).toBeNull();
  });
});

describe("birthDue", () => {
  it("not due before the planned month", () => {
    const s = sovereignCarrying(1); // birth at month 10, now is month 1
    expect(birthDue(db, s)).toBe(false);
  });
  it("due once past the planned month", () => {
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(2, 1, "early"), ap: 6, apMax: 6 }; // monthOrdinal 13 > 10
    expect(birthDue(db, s)).toBe(true);
  });
});

describe("buildBirth", () => {
  it("self-pregnancy → safe birth effect with favor 100 + lines; applying lands an heir", () => {
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6 };
    const plan = buildBirth(db, s);
    expect(plan).not.toBeNull();
    expect(plan!.bearer).toBe("sovereign");
    expect(plan!.bearerOutcome).toBe("safe");
    const birth = plan!.effects.find((e) => e.type === "birth");
    expect(birth).toBeDefined();
    expect(plan!.lines.length).toBeGreaterThan(0);
    const r = applyEffects(db, s, plan!.effects);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.resources.bloodline.heirs).toHaveLength(1);
      expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(100);
    }
  });

  it("returns null with no gestation", () => {
    expect(buildBirth(db, createNewGameState(db))).toBeNull();
  });
});
