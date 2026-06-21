import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, addGeneratedConsort } from "../../src/store/grandSelection";
import { monthOrdinal } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("addGeneratedConsort", () => {
  it("写入 generatedConsorts/standing/memories/bedchamber，含 availableFromMonth=五月", () => {
    const s = createNewGameState(db); // 元年
    const cand = generateCandidates(db, s, 1)[0]!;
    const next = addGeneratedConsort(s, cand.content, "guiren", 18);
    const id = cand.content.id;

    expect(next.generatedConsorts[id]).toBeDefined();
    expect(next.standing[id]!.rank).toBe("guiren");
    expect(next.standing[id]!.residence).toBe("chuxiu_gong");
    expect(next.standing[id]!.chamber).toBe("main");
    expect(next.standing[id]!.availableFromMonth).toBe(monthOrdinal({ year: 1, month: 5 }));
    expect(next.standing[id]!.favor).toBeGreaterThanOrEqual(10);
    expect(next.standing[id]!.favor).toBeLessThanOrEqual(20);
    expect(next.memories[id]!.entries.length).toBe(1);
    expect(next.bedchamber[id]).toEqual({ encounters: [] });
    // 不可变：原 state 未被改动
    expect(s.generatedConsorts[id]).toBeUndefined();
  });
});
