import { describe, expect, it } from "vitest";
import { eventEffectSchema } from "../../src/engine/content/schemas";

describe("eventEffectSchema: bedchamber + pregnancy", () => {
  it("accepts a bedchamber effect", () => {
    expect(eventEffectSchema.safeParse({ type: "bedchamber", char: "lu_huaijin", mode: "passion" }).success).toBe(true);
  });
  it("rejects unknown bedchamber mode", () => {
    expect(eventEffectSchema.safeParse({ type: "bedchamber", char: "x", mode: "lust" }).success).toBe(false);
  });
  it("accepts pregnancy begin/carry/clear", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "begin" }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "carry" }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "clear" }).success).toBe(true);
  });
  it("rejects an unknown pregnancy op", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm" }).success).toBe(false);
  });
  it("rejects pregnancy with extra fatherIds key (strict)", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "begin", fatherIds: ["x"] }).success).toBe(false);
  });
});
