import { describe, it, expect } from "vitest";
import { findAnachronisms, ANACHRONISM_TERMS, REGISTER_MARKERS } from "../../../src/engine/dialogue/eval/styleLexicon";

describe("styleLexicon", () => {
  it("flags modern terms", () => {
    expect(findAnachronisms("臣妾打开手机看了下系统")).toEqual(expect.arrayContaining(["手机", "系统"]));
  });

  it("clean classical line has no anachronisms", () => {
    expect(findAnachronisms("臣妾参见陛下，万福金安。")).toEqual([]);
  });

  it("exposes register tables for all four registers", () => {
    expect(Object.keys(REGISTER_MARKERS).sort()).toEqual(["casual", "formal", "poetic", "rough"]);
    expect(ANACHRONISM_TERMS.length).toBeGreaterThan(0);
  });
});
