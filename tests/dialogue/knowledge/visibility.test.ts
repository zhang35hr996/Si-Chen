/**
 * Suite B: resolveVisibilityCeiling — speaker kind → knowledge visibility ceiling.
 */
import { describe, it, expect } from "vitest";
import { resolveVisibilityCeiling } from "../../../src/engine/dialogue/knowledge/visibility";

describe("resolveVisibilityCeiling", () => {
  it("returns 'restricted' for elder speakers (太后 etc. have inner-court access)", () => {
    expect(resolveVisibilityCeiling("elder")).toBe("restricted");
  });

  it("returns 'public' for consort speakers", () => {
    expect(resolveVisibilityCeiling("consort")).toBe("public");
  });

  it("returns 'public' for official speakers", () => {
    expect(resolveVisibilityCeiling("official")).toBe("public");
  });
});
