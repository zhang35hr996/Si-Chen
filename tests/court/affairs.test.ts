import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/engine/content/loader";
import {
  COURT_CHECKPOINT,
  COURT_MAX_AFFAIRS,
  COURT_MIN_AFFAIRS,
  courtAffairPool,
  pickCourtAffairs,
} from "../../src/engine/court/affairs";
import { readContentDir } from "../../tools/validate-content";
import { join } from "node:path";

const db = (() => {
  const { raw } = readContentDir(join(process.cwd(), "content"));
  const result = loadContent(raw);
  if (!result.ok) throw new Error(result.error.map((e) => e.message).join("\n"));
  return result.value;
})();

describe("court affair pool", () => {
  it("collects exactly the court-checkpoint events (10 authored affairs)", () => {
    const pool = courtAffairPool(db);
    expect(pool.length).toBe(10);
    for (const id of pool) {
      expect(db.events[id]?.checkpoint).toBe(COURT_CHECKPOINT);
      expect(db.events[id]?.apCost).toBe(0); // 整场上朝只扣 1 点，事务本身不扣
    }
  });

  it("never auto-fires: court events carry the inert 'court' checkpoint", () => {
    for (const id of courtAffairPool(db)) {
      expect(["game_start", "location_enter", "time_advance", "scene_end"]).not.toContain(
        db.events[id]?.checkpoint,
      );
    }
  });
});

describe("pickCourtAffairs", () => {
  it("draws between MIN and MAX distinct affairs", () => {
    for (let day = 0; day < 50; day++) {
      const picked = pickCourtAffairs(db, `court:1:${day}`);
      expect(picked.length).toBeGreaterThanOrEqual(COURT_MIN_AFFAIRS);
      expect(picked.length).toBeLessThanOrEqual(COURT_MAX_AFFAIRS);
      expect(new Set(picked).size).toBe(picked.length); // 互不相同
      for (const id of picked) expect(courtAffairPool(db)).toContain(id);
    }
  });

  it("is deterministic for the same seed key", () => {
    expect(pickCourtAffairs(db, "court:7:3")).toEqual(pickCourtAffairs(db, "court:7:3"));
  });

  it("varies across days (not always the identical draw)", () => {
    const draws = new Set(Array.from({ length: 20 }, (_, d) => pickCourtAffairs(db, `court:1:${d}`).join(",")));
    expect(draws.size).toBeGreaterThan(1);
  });
});
