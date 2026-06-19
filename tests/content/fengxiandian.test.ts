import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error(`content failed: ${JSON.stringify(content.error)}`);
const db = content.value;

describe("奉先殿 location", () => {
  it("loads as a palace travel node, symmetric with 御书房", () => {
    const loc = db.locations["fengxiandian"];
    expect(loc).toBeDefined();
    expect(loc!.zone).toBe("palace");
    expect(loc!.connections).toContain("zichendian");
    expect(db.locations["zichendian"]!.connections).toContain("fengxiandian");
  });
});
