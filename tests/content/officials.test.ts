// tests/content/officials.test.ts
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { legacyConsortContent } from "../helpers/consortFixture";

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

describe("consort maternalClan", () => {
  // Authored story consorts were removed from content/; consorts are now procedurally
  // generated. The legacy test fixtures reconstruct the deleted consorts and must keep
  // a valid maternalClan (withConsort's family regen depends on the postId resolving).
  it("each legacy story consort declares a maternalClan referencing a real post", () => {
    const consorts = ["lu_huaijin", "xu_qinghuan", "shen_zhibai", "wenya"].map(legacyConsortContent);
    for (const c of consorts) {
      expect(c.profile.surname, c.id).toBeTruthy();
      expect(c.maternalClan, c.id).toBeDefined();
      expect(db.officialPosts[c.maternalClan!.postId], c.id).toBeDefined();
      expect(c.maternalClan!.birthOrder).toBeGreaterThanOrEqual(1);
    }
  });
});
