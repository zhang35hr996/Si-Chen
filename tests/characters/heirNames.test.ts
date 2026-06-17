import { describe, expect, it } from "vitest";
import { randomPetName, PET_NAME_POOL } from "../../src/engine/characters/heirNames";

describe("randomPetName", () => {
  it("returns a 2-char name from the pool", () => {
    const name = randomPetName(12345, "heir_000001");
    expect(PET_NAME_POOL).toContain(name);
    expect([...name].length).toBe(2);
  });

  it("is deterministic for the same seed + heir id", () => {
    expect(randomPetName(7, "heir_000003")).toBe(randomPetName(7, "heir_000003"));
  });

  it("varies across heir ids", () => {
    const a = randomPetName(7, "heir_000001");
    const b = randomPetName(7, "heir_000002");
    expect(PET_NAME_POOL).toContain(a);
    expect(PET_NAME_POOL).toContain(b);
  });
});
