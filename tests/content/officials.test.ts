// tests/content/officials.test.ts
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("officialPosts table", () => {
  it("loads into ContentDB keyed by id, with valid gradeOrder bounds", () => {
    const posts = db.officialPosts;
    expect(Object.keys(posts).length).toBeGreaterThan(10);
    for (const p of Object.values(posts)) {
      expect(p.gradeOrder).toBeGreaterThanOrEqual(0);
      expect(p.gradeOrder).toBeLessThanOrEqual(18);
    }
    expect(posts["commoner"]?.gradeOrder).toBe(0);
    expect(posts["bingbu_shangshu"]).toMatchObject({ name: "兵部尚书", grade: "从二品" });
  });

  it("no post name contains the male-leaning 郎/卿 (official-naming-rule)", () => {
    for (const p of Object.values(db.officialPosts)) {
      expect(p.name.includes("郎")).toBe(false);
      expect(p.name.includes("卿")).toBe(false);
    }
  });
});
