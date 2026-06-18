import { describe, expect, it } from "vitest";
import {
  characterSchema,
  gameEventSchema,
  locationSchema,
  sceneSchema,
} from "../../src/engine/content/schemas";
import { buildScaffold } from "../../tools/new-content";

describe("buildScaffold", () => {
  it("character stub is schema-valid and carries the id", () => {
    const { dir, filename, data } = buildScaffold("character", "wenya_shijun");
    expect(dir).toBe("content/characters");
    expect(filename).toBe("wenya_shijun.json");
    const parsed = characterSchema.safeParse(data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((data as { id: string }).id).toBe("wenya_shijun");
  });

  it("location stub is schema-valid", () => {
    const { data } = buildScaffold("location", "lenggong_side");
    expect(locationSchema.safeParse(data).success).toBe(true);
  });

  it("event stub is schema-valid and derives its scene id", () => {
    const { data } = buildScaffold("event", "ev_lenggong_first_visit");
    expect(gameEventSchema.safeParse(data).success).toBe(true);
    expect((data as { sceneId: string }).sceneId).toBe("sc_lenggong_first_visit");
  });

  it("event stub derives scene id across an arc namespace", () => {
    const { data } = buildScaffold("event", "arc_lenggong__ev_first_visit");
    expect((data as { sceneId: string }).sceneId).toBe("sc_first_visit");
  });

  it("scene stub is schema-valid (unique nodes, reachable terminal)", () => {
    const { data } = buildScaffold("scene", "sc_lenggong_first_visit");
    expect(sceneSchema.safeParse(data).success).toBe(true);
  });

  it("stubs use no future-only fields", () => {
    const json = JSON.stringify([
      buildScaffold("character", "x").data,
      buildScaffold("location", "y").data,
      buildScaffold("event", "ev_z").data,
      buildScaffold("scene", "sc_z").data,
    ]);
    for (const forbidden of ["generate", "schedule", "secretRevealed"]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });
});
