import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error(`content failed: ${JSON.stringify(content.error)}`);
const db = content.value;

describe("朝堂 上朝限时", () => {
  it("chaotang carries actionFirstSlotOnly = true", () => {
    expect(db.locations["xuanzhengdian"]!.actionFirstSlotOnly).toBe(true);
  });
});
