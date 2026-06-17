import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error(`content failed: ${JSON.stringify(content.error)}`);
const db = content.value;

describe("上书房 location", () => {
  it("loads as a palace travel node connected to 御书房 (symmetric)", () => {
    const loc = db.locations["shangshufang"];
    expect(loc).toBeDefined();
    expect(loc!.zone).toBe("palace");
    expect(loc!.entry).toBe("travel");
    expect(loc!.connections).toContain("yushufang");
    expect(db.locations["yushufang"]!.connections).toContain("shangshufang");
  });
});
