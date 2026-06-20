import { describe, expect, it } from "vitest";
import { generateOfficials } from "../../src/engine/officials/generate";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("generateOfficials", () => {
  it("is deterministic for a given seed", () => {
    expect(generateOfficials(db, 1)).toEqual(generateOfficials(db, 1));
  });
  it("creates exactly one head per consort surname-with-maternalClan, matching postId", () => {
    const officials = generateOfficials(db, 1);
    const consorts = Object.values(db.characters).filter((c) => c.kind === "consort" && c.maternalClan && c.profile.surname);
    const surnames = new Set(consorts.map((c) => c.profile.surname!));
    for (const surname of surnames) {
      const head = Object.values(officials).find((o) => o.surname === surname);
      expect(head, surname).toBeDefined();
      const consort = consorts.find((c) => c.profile.surname === surname)!;
      expect(head!.postId).toBe(consort.maternalClan!.postId);
    }
  });
  it("adds 8 unlinked officials beyond the heads, with unique surnames", () => {
    const officials = generateOfficials(db, 1);
    const headSurnames = new Set(
      Object.values(db.characters).filter((c) => c.kind === "consort" && c.maternalClan && c.profile.surname).map((c) => c.profile.surname),
    );
    const unlinked = Object.values(officials).filter((o) => !headSurnames.has(o.surname));
    expect(unlinked).toHaveLength(8);
    const allSurnames = Object.values(officials).map((o) => o.surname);
    expect(new Set(allSurnames).size).toBe(allSurnames.length); // no surname collision
  });
});
