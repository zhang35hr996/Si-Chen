import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

describe("太后 + 慈宁宫 content", () => {
  const result = loadGameContent();

  it("loads without errors", () => {
    expect(result.ok).toBe(true);
  });

  it("太后 is an elder with no standing, no attributes", () => {
    if (!result.ok) return;
    const c = result.value.characters["taihou"];
    expect(c).toBeDefined();
    expect(c!.kind).toBe("elder");
    expect(c!.attributes).toBeUndefined();
    expect(c!.defaultLocation).toBe("cining_gong");
    expect(c!.portraitSet).toBe("taihou");
  });

  it("慈宁宫 is a palace travel node bidirectionally linked to 御书房", () => {
    if (!result.ok) return;
    const loc = result.value.locations["cining_gong"];
    expect(loc).toBeDefined();
    expect(loc!.zone).toBe("palace");
    expect(loc!.entry).toBe("travel");
    expect(loc!.connections).toContain("yushufang");
    expect(result.value.locations["yushufang"]!.connections).toContain("cining_gong");
  });
});
