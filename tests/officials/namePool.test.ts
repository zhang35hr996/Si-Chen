import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SURNAME_POOL, OFFICIAL_GIVEN_NAME_POOL, pickGivenName, pickSurname,
} from "../../src/engine/officials/namePool";

describe("official name pools", () => {
  it("pools are non-empty and contain no 郎/卿 (official-naming-rule)", () => {
    expect(OFFICIAL_SURNAME_POOL.length).toBeGreaterThan(10);
    expect(OFFICIAL_GIVEN_NAME_POOL.length).toBeGreaterThan(10);
    for (const n of [...OFFICIAL_SURNAME_POOL, ...OFFICIAL_GIVEN_NAME_POOL]) {
      expect(n.includes("郎") || n.includes("卿")).toBe(false);
    }
  });
  it("pickGivenName is deterministic", () => {
    expect(pickGivenName("s")).toBe(pickGivenName("s"));
    expect(OFFICIAL_GIVEN_NAME_POOL).toContain(pickGivenName("s"));
  });
  it("pickSurname avoids used surnames", () => {
    const used = new Set(OFFICIAL_SURNAME_POOL.slice(0, OFFICIAL_SURNAME_POOL.length - 1));
    expect(used.has(pickSurname("k", used))).toBe(false);
  });
});
