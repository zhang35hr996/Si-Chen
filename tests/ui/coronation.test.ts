import { describe, it, expect } from "vitest";
import { isValidEraName } from "../../src/ui/screens/CoronationScreen";

describe("isValidEraName", () => {
  it("恰好两个中文字通过", () => {
    expect(isValidEraName("甘露")).toBe(true);
    expect(isValidEraName("永熙")).toBe(true);
  });
  it("非两字或非中文拒绝", () => {
    expect(isValidEraName("甘")).toBe(false);
    expect(isValidEraName("甘露露")).toBe(false);
    expect(isValidEraName("ab")).toBe(false);
    expect(isValidEraName("甘1")).toBe(false);
    expect(isValidEraName("")).toBe(false);
  });
});
