import { describe, expect, it } from "vitest";
import { isIll } from "../../../src/engine/characters/health";

describe("isIll", () => {
  it("healthy is not ill", () => {
    expect(isIll("healthy")).toBe(false);
  });
  it("sick and critical are ill", () => {
    expect(isIll("sick")).toBe(true);
    expect(isIll("critical")).toBe(true);
  });
});
