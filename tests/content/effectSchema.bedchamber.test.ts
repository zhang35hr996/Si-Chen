import { describe, expect, it } from "vitest";
import { eventEffectSchema } from "../../src/engine/content/schemas";

describe("eventEffectSchema: bedchamber + pregnancy", () => {
  it("accepts a bedchamber effect", () => {
    expect(eventEffectSchema.safeParse({ type: "bedchamber", char: "shen_chenghui", mode: "passion" }).success).toBe(true);
  });
  it("rejects unknown bedchamber mode", () => {
    expect(eventEffectSchema.safeParse({ type: "bedchamber", char: "x", mode: "lust" }).success).toBe(false);
  });
  it("accepts pregnancy begin/clear without fatherIds", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "begin" }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "clear" }).success).toBe(true);
  });
  it("accepts pregnancy confirm with 1–3 fatherIds", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: ["chu_jun"] }).success).toBe(true);
    expect(
      eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: ["a", "b", "c"] }).success,
    ).toBe(true);
  });
  it("rejects confirm with 0 or 4 fatherIds", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: [] }).success).toBe(false);
    expect(
      eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: ["a", "b", "c", "d"] }).success,
    ).toBe(false);
  });
});
