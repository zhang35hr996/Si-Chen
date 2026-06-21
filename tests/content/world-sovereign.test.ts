import { describe, expect, it } from "vitest";
import { worldSchema } from "../../src/engine/content/schemas";
import rawWorld from "../../content/world.json";

describe("world.sovereign.startingAge", () => {
  it("world.json parses with sovereign.startingAge", () => {
    const parsed = worldSchema.parse(rawWorld);
    expect(parsed.sovereign.startingAge).toBe(18);
  });
  it("rejects missing sovereign", () => {
    const { sovereign, ...rest } = worldSchema.parse(rawWorld) as Record<string, unknown> & {
      sovereign: unknown;
    };
    void sovereign;
    expect(worldSchema.safeParse(rest).success).toBe(false);
  });
});
