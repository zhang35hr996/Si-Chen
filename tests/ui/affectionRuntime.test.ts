import { describe, expect, it } from "vitest";
import { effectiveAffection } from "../../src/ui/components/CharacterProfileDrawer";

describe("effectiveAffection", () => {
  it("有运行时值取运行时", () => {
    expect(effectiveAffection({ affection: 30 }, { affection: 72 })).toBe(72);
  });
  it("无运行时值回退 authored", () => {
    expect(effectiveAffection({ affection: 30 }, undefined)).toBe(30);
    expect(effectiveAffection({ affection: 30 }, {})).toBe(30);
  });
});
